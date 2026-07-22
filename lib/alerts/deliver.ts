import { assertUrlAllowed } from "@/lib/net/ssrf-guard";
import type { AlertFire } from "./evaluate";

/**
 * Alert delivery. The upstream repo evaluated alerts but never sent them —
 * this wires the fires[] to real channels. Webhook/Slack work with no extra
 * deps; Telegram works with a bot token in the alert config; email is left as
 * a documented no-op until SMTP is configured.
 */

export type AlertChannel = "EMAIL" | "WEBHOOK" | "SLACK" | "TELEGRAM";

export interface AlertConfig {
  webhookUrl?: string; // generic JSON webhook or Slack incoming webhook
  slackWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  [key: string]: unknown;
}

async function postJson(url: string, body: unknown): Promise<boolean> {
  // Guard outbound webhooks too — a config-supplied URL is a potential SSRF.
  await assertUrlAllowed(url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

/**
 * Deliver a single fired alert over the alert's configured channel. Returns
 * true on success. Never throws — delivery failures are logged and swallowed
 * so one bad channel doesn't abort the batch.
 */
export async function deliverAlert(
  fire: AlertFire,
  channel: AlertChannel,
  config: AlertConfig
): Promise<boolean> {
  const text = `🚨 ${fire.message}`;
  try {
    switch (channel) {
      case "SLACK": {
        const url =
          config.slackWebhookUrl ||
          config.webhookUrl ||
          process.env.ALERT_SLACK_WEBHOOK_URL;
        if (!url) return false;
        return await postJson(url, { text });
      }
      case "WEBHOOK": {
        const url = config.webhookUrl || process.env.ALERT_WEBHOOK_URL;
        if (!url) return false;
        return await postJson(url, {
          type: fire.type,
          siteId: fire.siteId,
          domain: fire.domain,
          message: fire.message,
          firedAt: new Date().toISOString(),
        });
      }
      case "TELEGRAM": {
        const token =
          config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
        const chatId =
          config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
        if (!token || !chatId) return false;
        return await postJson(
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: chatId, text }
        );
      }
      case "EMAIL":
      default:
        // Email delivery needs SMTP wiring (nodemailer/Resend) which is not
        // configured in this build. Fall back to a generic webhook if present.
        if (process.env.ALERT_WEBHOOK_URL) {
          return await postJson(process.env.ALERT_WEBHOOK_URL, {
            type: fire.type,
            domain: fire.domain,
            message: fire.message,
          });
        }
        console.warn(
          `[alerts] No delivery channel available for ${channel}; alert not sent: ${fire.message}`
        );
        return false;
    }
  } catch (err) {
    console.error(`[alerts] Delivery failed (${channel}):`, err);
    return false;
  }
}

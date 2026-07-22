import { db } from "@/lib/db";
import { syncAllUserSites } from "@/lib/workers/gsc-sync";
import { syncVitalsForSite } from "@/lib/workers/vitals-sync";
import { evaluateAlertsForUser } from "@/lib/alerts/evaluate";

/**
 * Scheduled job entrypoint. The upstream project shipped no scheduler, so
 * "monitoring" only ran on manual clicks. Drive this route from an external
 * cron (host crontab, systemd timer, or a compose sidecar) with the shared
 * secret:
 *
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://seo.example.com/api/cron?job=gsc"     # hourly
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://seo.example.com/api/cron?job=vitals"  # daily
 *
 * job = gsc | vitals | alerts | all (default: gsc+alerts).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

async function runJob(job: string) {
  const users = await db.user.findMany({ select: { id: true } });
  const summary: Record<string, unknown> = {
    job,
    users: users.length,
    gscSites: 0,
    vitalsSites: 0,
    alertsFired: 0,
  };

  for (const { id: userId } of users) {
    if (job === "gsc" || job === "all") {
      const results = await syncAllUserSites(userId);
      summary.gscSites = (summary.gscSites as number) + results.length;
    }

    if (job === "vitals" || job === "all") {
      const sites = await db.site.findMany({
        where: { userId },
        select: { id: true },
      });
      for (const site of sites) {
        try {
          await syncVitalsForSite(userId, site.id);
          summary.vitalsSites = (summary.vitalsSites as number) + 1;
        } catch (err) {
          console.error(`[cron] vitals failed for site ${site.id}:`, err);
        }
      }
    }

    if (job === "gsc" || job === "alerts" || job === "all") {
      const fires = await evaluateAlertsForUser(userId);
      summary.alertsFired = (summary.alertsFired as number) + fires.length;
    }
  }

  return summary;
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return unauthorized();

  const job = new URL(req.url).searchParams.get("job") ?? "gsc";
  const allowed = new Set(["gsc", "vitals", "alerts", "all"]);
  if (!allowed.has(job)) {
    return Response.json(
      { error: `Invalid job "${job}". Use gsc | vitals | alerts | all.` },
      { status: 400 }
    );
  }

  try {
    const summary = await runJob(job);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron] job failed:", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Cron failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return handle(req);
}

// GET allowed too, so platforms that only issue GET cron pings can use it.
export async function GET(req: Request) {
  return handle(req);
}

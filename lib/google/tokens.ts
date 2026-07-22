import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/encryption";
import type { Prisma } from "@prisma/client";

/**
 * Single source of truth for reading/writing/refreshing a user's Google OAuth
 * tokens. Tokens are stored AES-256-GCM encrypted at rest (a base64 `iv:ct:tag`
 * string) in the `User.googleTokens` JSON column, with transparent one-time
 * migration of any legacy plaintext values written before this was added.
 */

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

/** Encrypted values are exactly three base64 segments joined by ":". */
function looksEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.split(":").length === 3;
}

/** Decode whatever is in the DB column — encrypted string or legacy plaintext. */
export function decodeTokens(raw: Prisma.JsonValue | null): GoogleTokens | null {
  if (raw == null) return null;
  if (looksEncrypted(raw)) {
    try {
      return JSON.parse(decrypt(raw)) as GoogleTokens;
    } catch {
      return null; // corrupt / wrong key
    }
  }
  // Legacy plaintext: either a JSON object column or a plain JSON string.
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as GoogleTokens;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw as unknown as GoogleTokens;
  }
  return null;
}

/** Encrypt tokens into the value stored in the JSON column. */
export function encodeTokens(tokens: GoogleTokens): string {
  return encrypt(JSON.stringify(tokens));
}

/** Persist tokens (encrypted) for a user by id. */
export async function saveGoogleTokensById(
  userId: string,
  tokens: GoogleTokens
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { googleTokens: encodeTokens(tokens) },
  });
}

/** Persist tokens (encrypted) for a user by email (used at sign-in). */
export async function saveGoogleTokensByEmail(
  email: string,
  tokens: GoogleTokens
): Promise<void> {
  await db.user.update({
    where: { email },
    data: { googleTokens: encodeTokens(tokens) },
  });
}

async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Returns a valid access token for the user, refreshing (and re-encrypting) if
 * it is missing or expiring within 5 minutes. Also transparently re-writes any
 * legacy plaintext token blob in encrypted form on first use.
 */
export async function getAccessToken(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { googleTokens: true },
  });

  const tokens = decodeTokens(user?.googleTokens ?? null);
  if (!tokens?.accessToken || !tokens.refreshToken) {
    throw new Error("User has no Google OAuth tokens");
  }

  const expiringSoon =
    !tokens.expiresAt || tokens.expiresAt - Date.now() < 5 * 60 * 1000;

  if (expiringSoon) {
    const { accessToken, expiresAt } = await refreshAccessToken(
      tokens.refreshToken
    );
    const updated = { ...tokens, accessToken, expiresAt };
    await saveGoogleTokensById(userId, updated);
    return accessToken;
  }

  // Re-encrypt legacy plaintext on first read even when no refresh is needed.
  if (!looksEncrypted(user?.googleTokens)) {
    await saveGoogleTokensById(userId, tokens);
  }

  return tokens.accessToken;
}

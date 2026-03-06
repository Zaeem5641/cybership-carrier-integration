import { CarrierError, authError, unexpectedError } from "../errors.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function toBase64(str: string): string {
  return Buffer.from(str, "utf8").toString("base64");
}

/** Returns a valid UPS OAuth token; uses in-memory cache until 5 min before expiry. */
export async function getToken(fetchFn: typeof fetch = fetch): Promise<string> {
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;
  const baseUrl = process.env.UPS_BASE_URL?.replace(/\/$/, "");
  
  if (!clientId || !clientSecret || !baseUrl) {
    throw new Error("Missing UPS_CLIENT_ID, UPS_CLIENT_SECRET, or UPS_BASE_URL");
  }

  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + FIVE_MINUTES_MS) {
    return cachedToken;
  }
  cachedToken = null;

  const url = `${baseUrl}/security/v1/oauth/token`;
  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();
  const authHeader = toBase64(`${clientId}:${clientSecret}`);

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authHeader}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw authError(`UPS OAuth failed: ${res.status} ${text}`, "ups");
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number | string };
    const accessToken = data.access_token;
    const expiresIn = typeof data.expires_in === "string" ? parseInt(data.expires_in, 10) : data.expires_in;
    if (!accessToken || !expiresIn) {
      throw unexpectedError("UPS OAuth response missing access_token or expires_in", "ups");
    }

    cachedToken = accessToken;
    tokenExpiresAt = now + expiresIn * 1000;
    return cachedToken;
  } catch (err) {
    if (err instanceof CarrierError) throw err;
    throw unexpectedError(err instanceof Error ? err.message : "UPS OAuth failed", "ups");
  }
}

/** Clears the cached token (for tests or after 401). */
export function clearTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

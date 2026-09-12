import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Access gate for the control tower at /console.
 *
 * WHAT THIS IS: a single-tenant access gate. One shared code, verified on the
 * server, exchanged for an HMAC-signed session cookie. It is deliberately NOT a
 * user database — there are no per-user accounts in SilentOps, so a login form
 * with per-user passwords would be inventing an identity model the product does
 * not have.
 *
 * WHAT THIS IS NOT: the Auth0 boundary. Auth0 in this repo is machine-to-machine
 * (`packages/loop-core/src/boundary/auth0.ts`): it verifies a service token's
 * scope before a write, and it is R2's. This gate only decides who may LOOK at
 * the read-only review surface. It grants no write capability, because the
 * console performs no writes.
 *
 * If this is ever replaced with Auth0 Universal Login, replace this file and the
 * route that uses it; `/console` only asks one question — `sessionIsValid()`.
 *
 * Cookie flags and the 64-hex token shape follow the conventions already used by
 * `followup-http.ts` in this app.
 */

export const COOKIE_NAME = "silentops-console";

/** One shift. A supervisor should not stay signed in across rotations. */
const TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Signing key. If `CONSOLE_SESSION_SECRET` is absent we generate one per
 * process, which means a restart invalidates outstanding sessions. That is the
 * safe default: it never falls back to signing with the low-entropy access code
 * itself, which would let an attacker brute-force a stolen cookie offline.
 */
const processSecret = randomBytes(32).toString("hex");

function signingKey(): string {
  return process.env.CONSOLE_SESSION_SECRET?.trim() || processSecret;
}

function configuredCode(): string | undefined {
  const raw = process.env.CONSOLE_ACCESS_CODE?.trim();
  return raw ? raw : undefined;
}

/**
 * The gate fails closed. With no `CONSOLE_ACCESS_CODE` set, nobody gets in —
 * rather than the more tempting default of leaving an admin dashboard open
 * because configuration is missing.
 */
export function gateIsConfigured(): boolean {
  return configuredCode() !== undefined;
}

/** Constant-time comparison over digests, so length never leaks. */
export function codeMatches(candidate: string): boolean {
  const expected = configuredCode();
  if (!expected) return false;
  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

function sign(value: string): string {
  return createHmac("sha256", signingKey()).update(value).digest("hex");
}

/** `<expiryMs>.<hmac>` — stateless, so no session store to keep or leak. */
export function issueSession(now: number = Date.now()): string {
  const expiry = String(now + TTL_MS);
  return `${expiry}.${sign(expiry)}`;
}

export function sessionIsValid(
  token: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!token || !gateIsConfigured()) return false;
  const [expiry, signature] = token.split(".");
  if (!expiry || !signature) return false;
  if (!/^\d{1,15}$/.test(expiry) || !/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  const valid = timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(sign(expiry), "hex"),
  );
  return valid && Number(expiry) > now;
}

export function setCookie(token: string, secure: boolean): string {
  return [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearCookie(secure: boolean): string {
  return [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Attempt throttle. A single shared code is brute-forceable, so slow it down.
 * In-memory and per-process: enough for one dashboard, and it never becomes a
 * silent dependency on shared state across instances.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function throttleState(
  key: string,
  now: number = Date.now(),
): { blocked: boolean; retryAfterSeconds: number } {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    return { blocked: false, retryAfterSeconds: 0 };
  }
  return {
    blocked: entry.count >= MAX_ATTEMPTS,
    retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

export function recordFailure(key: string, now: number = Date.now()): void {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

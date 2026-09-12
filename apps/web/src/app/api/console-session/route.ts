import { z } from "zod";
import {
  COOKIE_NAME,
  clearCookie,
  clearFailures,
  codeMatches,
  gateIsConfigured,
  issueSession,
  recordFailure,
  throttleState,
} from "@/lib/server/console-session";

/**
 * Sign in and out of the control tower.
 *
 * POST { code } → sets the session cookie. DELETE → clears it.
 *
 * The Origin check mirrors `followup-http.ts`: Next can normalize
 * `request.url` to localhost, so the expected origin is rebuilt from the real
 * HTTP Host. Unlike that route this one is not loopback-only, because gating a
 * dashboard is exactly what you would deploy.
 *
 * Responses never distinguish "wrong code" from "no code configured" in a way
 * that helps an attacker, and never echo the submitted value.
 */

const body = z.object({ code: z.string().min(1).max(200) }).strict();

function expectedOrigin(request: Request): string {
  const url = new URL(request.url);
  url.host = request.headers.get("host") || url.host;
  return url.origin;
}

function isSecure(request: Request): boolean {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

/** Throttle key: the closest thing to a caller identity we have here. */
function throttleKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

function guard(request: Request): Response | undefined {
  if (request.headers.get("origin") !== expectedOrigin(request)) {
    return Response.json(
      { error: "Use the sign-in form on this app's own page." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return undefined;
}

export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;

  const headers = { "Cache-Control": "no-store" };

  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415, headers });
  }

  if (!gateIsConfigured()) {
    // Fail closed, and say so plainly: this is an operator configuration
    // problem, not a wrong code.
    return Response.json(
      {
        error:
          "The control tower is not configured. Set CONSOLE_ACCESS_CODE in root .env and restart the app.",
        unconfigured: true,
      },
      { status: 503, headers },
    );
  }

  const key = throttleKey(request);
  const throttle = throttleState(key);
  if (throttle.blocked) {
    return Response.json(
      {
        error: `Too many attempts. Try again in ${throttle.retryAfterSeconds} seconds.`,
      },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(throttle.retryAfterSeconds) },
      },
    );
  }

  let code: string;
  try {
    code = body.parse(await request.json()).code;
  } catch {
    return Response.json(
      { error: "Enter the access code for your hub." },
      { status: 400, headers },
    );
  }

  if (!codeMatches(code)) {
    recordFailure(key);
    return Response.json(
      { error: "That access code is not valid for this hub." },
      { status: 401, headers },
    );
  }

  clearFailures(key);
  return Response.json(
    { status: "signed-in" },
    {
      status: 200,
      headers: {
        ...headers,
        "Set-Cookie": `${COOKIE_NAME}=${issueSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${
          isSecure(request) ? "; Secure" : ""
        }`,
      },
    },
  );
}

export async function DELETE(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  return Response.json(
    { status: "signed-out" },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": clearCookie(isSecure(request)),
      },
    },
  );
}

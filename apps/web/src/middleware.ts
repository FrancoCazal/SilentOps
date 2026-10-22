import { NextResponse, type NextRequest } from "next/server";

/**
 * Starter-kit routes stay on loopback.
 *
 * `/kit-demo`, `/voice` and the endpoints behind them are inherited from the
 * hackathon starter kit and are not part of SilentOps. Several of them spend the
 * server's model credentials for any caller (`/api/realtime-token` mints OpenAI
 * Realtime sessions, `/api/copilotkit` runs the chat agent, `/api/search` calls
 * Exa) and none has authentication. On a public deployment they answer 404;
 * locally they work exactly as the kit documents.
 *
 * The check reads the Host header, like `followup-http.ts`. Set
 * ALLOW_KIT_ROUTES=1 to open them elsewhere, for example to reach the mobile
 * runtime from a phone on the LAN, and only behind your own authentication.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(host: string | null): string {
  try {
    return new URL(`http://${host ?? ""}`).hostname;
  } catch {
    return "";
  }
}

export function middleware(request: NextRequest) {
  if (process.env.ALLOW_KIT_ROUTES === "1") return NextResponse.next();

  if (LOOPBACK.has(hostnameOf(request.headers.get("host")))) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  // An unmatched path renders the app's not-found page with a 404 status.
  return NextResponse.rewrite(new URL("/404", request.url));
}

export const config = {
  matcher: [
    "/kit-demo/:path*",
    "/voice",
    "/api/copilotkit/:path*",
    "/api/mobile-copilotkit/:path*",
    "/api/realtime-token",
    "/api/search",
    "/api/followups",
  ],
};

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, consoleAccess } from "./console-session";

/**
 * Guard every control-tower route.
 *
 * Called from each page rather than from a shared layout on purpose: Next does
 * not re-render a layout on every client navigation, so a layout-only check can
 * be bypassed by navigating between segments. Three lines of repetition is the
 * right price for a gate that always runs.
 *
 * Returns which tower the page may render: `session` (live) or `demo` (sample
 * data only, when no access code is configured). On `demo` a page must not read
 * the workspace or show configuration state.
 *
 * `console-session.ts` stays free of Next imports so its tests can exercise the
 * crypto directly; this file is the only place the two are joined.
 */
export async function requireConsoleSession(
  returnTo: string,
): Promise<"session" | "demo"> {
  const store = await cookies();
  const access = consoleAccess(store.get(COOKIE_NAME)?.value);
  if (access === "denied") {
    redirect(`/access?next=${encodeURIComponent(returnTo)}`);
  }
  return access;
}

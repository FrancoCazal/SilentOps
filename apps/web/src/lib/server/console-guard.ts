import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, sessionIsValid } from "./console-session";

/**
 * Guard every control-tower route.
 *
 * Called from each page rather than from a shared layout on purpose: Next does
 * not re-render a layout on every client navigation, so a layout-only check can
 * be bypassed by navigating between segments. Three lines of repetition is the
 * right price for a gate that always runs.
 *
 * `console-session.ts` stays free of Next imports so its tests can exercise the
 * crypto directly; this file is the only place the two are joined.
 */
export async function requireConsoleSession(returnTo: string): Promise<void> {
  const store = await cookies();
  if (!sessionIsValid(store.get(COOKIE_NAME)?.value)) {
    redirect(`/access?next=${encodeURIComponent(returnTo)}`);
  }
}

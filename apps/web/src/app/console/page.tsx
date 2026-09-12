import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleView } from "@/components/console/console-view";
import { COOKIE_NAME, sessionIsValid } from "@/lib/server/console-session";

/**
 * Server guard for the control tower.
 *
 * The check happens here, on the server, before any console markup exists. A
 * client-side redirect would ship the dashboard to the browser and then ask it
 * politely to look away.
 *
 * `sessionIsValid` returns false when the gate is unconfigured, so a missing
 * `CONSOLE_ACCESS_CODE` locks the tower rather than opening it.
 */
export const metadata: Metadata = {
  title: "Control tower — SilentOps",
  description: "Shift review for the outgoing supervisor.",
};

/** The session cookie must never be cached into a shared response. */
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const store = await cookies();
  if (!sessionIsValid(store.get(COOKIE_NAME)?.value)) {
    redirect("/access?next=%2Fconsole");
  }
  return <ConsoleView />;
}

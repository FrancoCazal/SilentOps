import type { Metadata } from "next";
import { ConsoleView } from "@/components/console/console-view";
import { requireConsoleSession } from "@/lib/server/console-guard";

/**
 * Server guard for the control tower's Shift view.
 *
 * The check happens here, on the server, before any console markup exists. A
 * client-side redirect would ship the dashboard to the browser and then ask it
 * politely to look away.
 *
 * `requireConsoleSession` treats an unconfigured gate as locked, so a missing
 * `CONSOLE_ACCESS_CODE` closes the tower rather than opening it.
 */
export const metadata: Metadata = {
  title: "Control tower — SilentOps",
  description: "Shift review for the outgoing supervisor.",
};

/** The session cookie must never be cached into a shared response. */
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  await requireConsoleSession("/console");
  return <ConsoleView />;
}

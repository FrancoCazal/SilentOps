import type { Metadata } from "next";
import { ConsoleView } from "@/components/console/console-view";
import { LiveShift } from "@/components/console/live-shift";
import { requireConsoleSession } from "@/lib/server/console-guard";
import { loadShiftReview } from "@/lib/server/shift-review";

/**
 * Control tower · Shift.
 *
 * The access check happens here, on the server, before any console markup
 * exists. A client-side redirect would ship the dashboard to the browser and
 * then ask it politely to look away.
 *
 * With a readable workspace this renders live data. Without one it falls back to
 * the sample view and says why — a dashboard that silently shows fixtures while
 * looking live is worse than one that admits it cannot reach the workspace.
 */
export const metadata: Metadata = {
  title: "Control tower — SilentOps",
  description: "Shift review for the outgoing supervisor.",
};

/** Never cache a session-gated, workspace-backed response. */
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  await requireConsoleSession("/console");
  const review = await loadShiftReview();

  if (review.status === "unconfigured") {
    return (
      <ConsoleView
        notice={
          <>
            <strong>Showing sample data.</strong> No{" "}
            <code>AMBIGUOUS_API_KEY</code> is configured, so the tower cannot read
            the live workspace. Set it in root <code>.env</code> and reload for
            real shift data.
          </>
        }
      />
    );
  }

  if (review.status === "error") {
    return (
      <ConsoleView
        notice={
          <>
            <strong>Showing sample data.</strong> {review.message}
          </>
        }
      />
    );
  }

  return <LiveShift review={review} />;
}

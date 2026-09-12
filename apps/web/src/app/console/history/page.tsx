import type { Metadata } from "next";
import { ConsoleShell } from "@/components/console/console-shell";
import { EXPECTED_RECORD, history } from "@/components/handover/handover-data";
import { requireConsoleSession } from "@/lib/server/console-guard";
import styles from "@/components/console/console.module.css";

/**
 * Control tower · History — what the detector did at each past shift boundary.
 *
 * A server component: there is nothing to interact with, so nothing ships to the
 * browser. Read-only over synthetic data, like every console route.
 *
 * The "silent" rows carry the weight here. A history that listed only detections
 * would advertise the agent's activity and hide its restraint; the product claim
 * is that it stays quiet when the handover already exists, and that is only
 * credible if the quiet shifts are visible and counted.
 */
export const metadata: Metadata = {
  title: "History — SilentOps control tower",
  description: "Detector outcomes for past shift boundaries.",
};

export const dynamic = "force-dynamic";

const outcomeLabel = {
  approved: "Approved",
  rejected: "Rejected",
  silent: "Silent",
} as const;

const outcomeClass = {
  approved: styles.pillApproved,
  rejected: styles.pillRejected,
  silent: styles.pillSilent,
} as const;

export default async function HistoryPage() {
  await requireConsoleSession("/console/history");

  const detections = history.filter((entry) => entry.searchResults === 0);
  const approved = history.filter((entry) => entry.outcome === "approved");
  const rejected = history.filter((entry) => entry.outcome === "rejected");
  const silent = history.filter((entry) => entry.outcome === "silent");

  const summary = [
    { label: "Shift boundaries checked", value: history.length },
    { label: "Handover missing", value: detections.length },
    { label: "Approved", value: approved.length },
    { label: "Rejected", value: rejected.length },
    { label: "Silent · already present", value: silent.length },
  ];

  return (
    <ConsoleShell active="history">
      <div className={styles.subhead}>
        <div className={styles.subheadText}>
          <h1 className={styles.subheadTitle}>Shift history</h1>
          <p className={styles.subheadMeta}>
            Every boundary the detector checked, including the ones where it
            found nothing to do.
          </p>
        </div>
      </div>

      <div className={styles.pageBody}>
        <dl className={styles.summaryRow}>
          {summary.map((item) => (
            <div key={item.label} className={styles.summaryCell}>
              <dt className={styles.summaryLabel}>{item.label}</dt>
              <dd className={styles.summaryValue}>{item.value}</dd>
            </div>
          ))}
        </dl>

        <ul className={styles.historyList}>
          {history.map((entry) => {
            const missing = entry.searchResults === 0;
            return (
              <li key={entry.id} className={styles.historyRow}>
                <div className={styles.historyHead}>
                  <div className={styles.historyWhen}>
                    <span className={styles.historyDate}>{entry.date}</span>
                    <span className={styles.historyShift}>
                      {entry.shift} shift · {entry.outgoing} → {entry.incoming}
                    </span>
                  </div>
                  <span className={outcomeClass[entry.outcome]}>
                    {outcomeLabel[entry.outcome]}
                  </span>
                </div>

                <p className={styles.historyTrace}>
                  <span className={styles.traceGlyph} aria-hidden="true">
                    ⌕
                  </span>{" "}
                  searched Documents for &ldquo;{EXPECTED_RECORD.replace(
                    "Noche",
                    entry.shift === "Night" ? "Noche" : "Mañana",
                  )}
                  &rdquo; <span className={styles.traceArrow}>→</span>{" "}
                  <span className={missing ? styles.missing : styles.present}>
                    {entry.searchResults}{" "}
                    {entry.searchResults === 1 ? "result" : "results"}
                  </span>
                </p>

                <p className={styles.historyResult}>
                  {entry.result}
                  {entry.decidedBy && entry.decidedAt ? (
                    <span className={styles.historyDecided}>
                      {" "}
                      · {entry.decidedBy} decided at {entry.decidedAt}
                    </span>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>

        <p className={styles.pageNote}>
          Sample data. A live history reads from the same records the detector
          searched, so a row can always be traced back to the document or work
          order it came from.
        </p>
      </div>
    </ConsoleShell>
  );
}

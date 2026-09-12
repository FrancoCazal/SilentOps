"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  EXPECTED_RECORD,
  FACILITY,
  SHIFT_DATE,
  SUMMARY,
  evidence,
  ledger,
  ledgerClose,
  tabs,
  views,
  workOrders,
  type View,
} from "@/components/handover/handover-data";
import { ConsoleShell } from "./console-shell";
import styles from "./console.module.css";

/**
 * Control tower · Shift — the current shift boundary under review.
 *
 * Rendered only after `app/console/page.tsx` has verified the session cookie on
 * the server. This component performs no access check of its own; a client-side
 * gate would be decoration.
 *
 * SCOPE, read this before wiring anything to it:
 *
 * This is a READ-ONLY review view over synthetic demo data. It is not a second
 * approval path and must not become one. Approval happens in Slack, and every
 * write goes through `boundary/write.ts` with an Auth0 scope and an idempotency
 * key (invariants 1 and 2 in AGENTS.md). The state switcher below changes local
 * React state and nothing else — no fetch, no agent call, no write. If you
 * connect this page to a real proposal, the Approve button must call the same
 * `approveAndExecute` boundary the Slack card calls, never a new write path.
 *
 * `SILENTOPS.md` lists the control-tower web UI as a non-goal until Tier 0 is
 * verified and recorded, and `team-docs/contratos.md` marks it Tier 2.
 *
 * Design source: "Console approval states mockup/SilentOps App.dc.html".
 */

const ledgerToneClass: Record<string, string> = {
  missing: styles.closeMissing,
  done: styles.closeDone,
  refused: styles.closeRefused,
  quiet: styles.closeQuiet,
};

const dotToneClass: Record<string, string> = {
  missing: styles.dotMissing,
  done: styles.dotDone,
  refused: styles.dotRefused,
  quiet: styles.dotQuiet,
};

/** Visual marker that a claim carries a source; not a navigable link here. */
function SourceTag() {
  return <span className={styles.sourceTag}>↗ source</span>;
}

export function ConsoleView({ notice }: { notice?: ReactNode }) {
  const [view, setView] = useState<View>("pending");
  const current = views[view];
  const close = ledgerClose[view];

  /**
   * The mockup's clock creeps toward the 06:00 boundary while the handover is
   * still missing, and holds still otherwise. It starts from the state's fixed
   * value so the server and client render the same first frame.
   */
  const [clock, setClock] = useState(current.clock);
  useEffect(() => {
    setClock(views[view].clock);
    if (view !== "pending") return;
    const id = setInterval(() => {
      setClock((prev) => {
        const [h, m] = prev.split(":").map(Number);
        const total = h * 60 + m + 1;
        if (total >= 6 * 60) return "05:59";
        return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
          total % 60,
        ).padStart(2, "0")}`;
      });
    }, 4000);
    return () => clearInterval(id);
  }, [view]);

  return (
    <ConsoleShell
      active="shift"
      notice={notice}
      toolbar={
        <>
          <span className={styles.shiftPill}>Night shift</span>
          <span className={styles.clockWrap}>
            <span className={styles.clockDot} aria-hidden="true" />
            <span className={styles.clock}>{clock}</span>
          </span>
        </>
      }
    >
      <div className={styles.subhead}>
        <div className={styles.subheadText}>
          <h1 className={styles.subheadTitle}>
            Night shift closes 06:00 · Ana out, Bruno in
          </h1>
          <p className={styles.subheadMeta}>
            {SHIFT_DATE} · {FACILITY}
          </p>
        </div>
        <div
          className={styles.stateTabs}
          role="group"
          aria-label="Proposal state"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                view === tab.id ? styles.stateTabActive : styles.stateTab
              }
              aria-pressed={view === tab.id}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.columns}>
        <section className={styles.ledgerCol} aria-label="Shift ledger">
          <h2 className={styles.colLabel}>Shift ledger · {SHIFT_DATE}</h2>

          <ol className={styles.timeline}>
            {ledger.map((entry) => (
              <li key={entry.time} className={styles.entry}>
                <span className={styles.entryTime}>{entry.time}</span>
                <span className={styles.entryBody}>
                  <span className={styles.entryDot} aria-hidden="true" />
                  <span className={styles.entryDetail}>{entry.detail}</span>
                </span>
              </li>
            ))}

            <li className={styles.entry}>
              <span
                className={`${styles.entryTime} ${ledgerToneClass[close.tone]}`}
              >
                {close.time}
              </span>
              <span className={styles.entryBodyClose}>
                <span
                  className={`${styles.entryDotClose} ${dotToneClass[close.tone]}`}
                  aria-hidden="true"
                />
                {close.note ? (
                  <span
                    className={`${styles.closeBox} ${ledgerToneClass[close.tone]}`}
                  >
                    <span className={styles.closeTitle}>{close.title}</span>
                    <span className={styles.closeNote}>{close.note}</span>
                  </span>
                ) : (
                  <span className={styles.entryDetail}>{close.title}</span>
                )}
              </span>
            </li>
          </ol>
        </section>

        <section className={styles.detailCol} aria-label="Proposal">
          <div
            className={
              current.resultMissing
                ? styles.evidencePanel
                : `${styles.evidencePanel} ${styles.evidencePanelPresent}`
            }
          >
            <span className={styles.panelLabel}>Evidence of absence</span>
            <p className={styles.trace}>
              <span className={styles.traceGlyph} aria-hidden="true">
                ⌕
              </span>{" "}
              searched Documents for &ldquo;{EXPECTED_RECORD}&rdquo; at 05:45{" "}
              <span className={styles.traceArrow}>→</span>{" "}
              <span
                className={
                  current.resultMissing ? styles.missing : styles.present
                }
              >
                {current.result}
              </span>
            </p>
            <p className={styles.traceNote}>{current.note}</p>
          </div>

          {view === "silent" ? (
            <div className={styles.silentPanel}>
              <div className={styles.silentHead}>
                <span className={styles.silentTitle}>
                  Handover present. No action.
                </span>
                <SourceTag />
              </div>
              <p className={styles.silentBody}>
                The detector checked again at shift close and proposes nothing: a
                handover document already exists for this shift.
              </p>
            </div>
          ) : (
            <article
              className={
                view === "approved"
                  ? `${styles.card} ${styles.cardApproved}`
                  : view === "rejected"
                    ? `${styles.card} ${styles.cardRejected}`
                    : styles.card
              }
            >
              <div className={styles.cardHeader}>
                <div className={styles.cardHeading}>
                  <h2 className={styles.cardTitle}>Handover proposal</h2>
                  <span className={styles.cardSubline}>{current.subline}</span>
                </div>
                <span className={styles.riskBadge}>medium risk</span>
              </div>

              <div className={styles.cardBody}>
                <p className={styles.cardSummary}>{SUMMARY}</p>

                <div className={styles.cardGroup}>
                  <span className={styles.panelLabel}>Evidence</span>
                  <ul className={styles.rowList}>
                    {evidence.map((item) => (
                      <li key={item} className={styles.row}>
                        <span className={styles.rowMain}>
                          <span className={styles.bullet} aria-hidden="true">
                            •
                          </span>
                          <span className={styles.rowText}>{item}</span>
                        </span>
                        <SourceTag />
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={styles.cardGroup}>
                  <span className={styles.cardGroupTitle}>
                    {current.ordersLabel}
                  </span>
                  <ul className={styles.rowList}>
                    {workOrders.map((order) => (
                      <li key={order.id} className={styles.row}>
                        <span className={styles.rowMain}>
                          <span className={styles.orderId}>{order.id}</span>
                          <span className={styles.rowText}>{order.title}</span>
                        </span>
                        <SourceTag />
                      </li>
                    ))}
                  </ul>
                </div>

                {view === "pending" && (
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.approveButton}
                      onClick={() => setView("approved")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className={styles.rejectButton}
                      onClick={() => setView("rejected")}
                    >
                      Reject
                    </button>
                    <span className={styles.actionsNote}>
                      Ana approves · outgoing supervisor
                    </span>
                  </div>
                )}

                {view === "approved" && (
                  <div className={styles.outcomeApproved}>
                    <span className={styles.outcomeText}>
                      <span className={styles.outcomeMark} aria-hidden="true">
                        ✓
                      </span>{" "}
                      Approved by Ana · 05:47
                    </span>
                    <span className={styles.outcomeLink}>
                      Handover created ↗
                    </span>
                  </div>
                )}

                {view === "rejected" && (
                  <div className={styles.outcomeRejected}>
                    <span className={styles.outcomeTextRejected}>
                      <span aria-hidden="true">✕</span> Rejected by Ana · 05:47
                    </span>
                    <span className={styles.outcomeNote}>
                      nothing was written
                    </span>
                  </div>
                )}
              </div>
            </article>
          )}
        </section>
      </div>
    </ConsoleShell>
  );
}

"use client";

import { useState } from "react";
import {
  CHANNEL,
  EXPECTED_RECORD,
  SUMMARY,
  evidence,
  tabs,
  views,
  workOrders,
  type View,
} from "@/components/handover/handover-data";
import styles from "./landing.module.css";

/**
 * The approval card, previewed on the landing page in each of its states.
 *
 * SilentOps runs in Slack: the proposal and the decision both happen in the
 * operations channel. This is a faithful preview of that card, not a second
 * product surface — nothing here calls the agent or writes anything.
 *
 * Copy and demo data come from `handover-data.ts`, shared with /console so the
 * two surfaces cannot contradict each other.
 *
 * The search trace is reproduced verbatim, including the Spanish document name
 * it looks for. SILENTOPS.md requires the absence to read as a statement
 * ("0 results"), never as blank space.
 *
 * Design source: "Console approval states mockup/SilentOps App.dc.html".
 */

/** Visual marker that a claim carries a source; not a navigable link here. */
function SourceTag() {
  return <span className={styles.sourceTag}>↗ source</span>;
}

export function ApprovalStates() {
  const [view, setView] = useState<View>("pending");
  const current = views[view];

  return (
    <div className={styles.approval}>
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

      <div className={styles.slackFrame}>
        <div className={styles.slackHeader}>
          <span className={styles.slackChannel}>{CHANNEL}</span>
          <span className={styles.slackDivider} aria-hidden="true">
            ·
          </span>
          <span className={styles.slackApp}>SilentOps</span>
          <span className={styles.slackBadge}>APP</span>
          <span className={styles.slackClock}>{current.clock}</span>
        </div>

        <div className={styles.slackBody}>
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
                className={current.resultMissing ? styles.missing : styles.present}
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
                  <h3 className={styles.cardTitle}>Handover proposal</h3>
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
        </div>
      </div>

      <p className={styles.approvalCaption}>
        A preview of the real card. These four states are what the outgoing
        supervisor can see in the channel; this page does not execute anything.
      </p>
    </div>
  );
}

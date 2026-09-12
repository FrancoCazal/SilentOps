import { ConsoleShell } from "./console-shell";
import type { ShiftFacts, ShiftReview } from "@/lib/server/shift-review";
import styles from "./console.module.css";

/**
 * Control tower · Shift, over live workspace data.
 *
 * A server component: everything here is read on the server and rendered as
 * HTML, so no workspace data passes through a client bundle and the page ships
 * no JavaScript.
 *
 * There is no Approve button. Approval belongs to the Slack card, where the
 * decision is recorded and where `approveAndExecute` enforces the Auth0 scope and
 * idempotency key. Putting one here would be a second write path — the exact
 * thing invariants 1 and 2 forbid. The tower reports; Slack decides.
 */

function ShiftFactsPanel({ shift }: { shift: ShiftFacts }) {
  const closing =
    shift.minutesToClose >= 0
      ? `closes in ${shift.minutesToClose} min`
      : `closed ${Math.abs(shift.minutesToClose)} min ago`;
  return (
    <dl className={styles.factList}>
      <div className={styles.fact}>
        <dt className={styles.factLabel}>Shift</dt>
        <dd className={styles.factValue}>
          {shift.name} · {shift.start} → {shift.end} · {closing}
        </dd>
      </div>
      <div className={styles.fact}>
        <dt className={styles.factLabel}>Going off</dt>
        <dd className={styles.factValue}>
          {shift.outgoing.length ? shift.outgoing.join(", ") : "—"}
        </dd>
      </div>
      <div className={styles.fact}>
        <dt className={styles.factLabel}>Coming on</dt>
        <dd className={styles.factValue}>
          {shift.incoming.length ? shift.incoming.join(", ") : "—"}
        </dd>
      </div>
    </dl>
  );
}

export function LiveShift({ review }: { review: ShiftReview }) {
  if (review.status === "unconfigured" || review.status === "error") {
    throw new Error("LiveShift requires a readable workspace");
  }

  const clock = new Date(review.at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <ConsoleShell
      active="shift"
      badge="Live · read-only"
      toolbar={
        <>
          {review.status !== "idle" && (
            <span className={styles.shiftPill}>{review.shift.name} shift</span>
          )}
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
            {review.status === "idle"
              ? "No shift is closing right now"
              : review.status === "present"
                ? `${review.shift.name} shift closes ${review.shift.end} · handover on record`
                : `${review.shift.name} shift closes ${review.shift.end} · handover missing`}
          </h1>
          <p className={styles.subheadMeta}>
            Read from the live workspace at {clock}
          </p>
        </div>
      </div>

      <div className={styles.pageBody}>
        {review.status === "idle" ? (
          <section className={styles.settingsBlock}>
            <h2 className={styles.blockTitle}>Detector idle</h2>
            <p className={styles.blockNote}>
              The detector runs in the 15 minutes before a shift closes. Outside
              that window there is nothing to check, and staying quiet is the
              correct behaviour rather than a missing feature.
            </p>
            {review.shift ? (
              <ShiftFactsPanel shift={review.shift} />
            ) : (
              <p className={styles.blockNote}>
                No shift is currently on record in the workspace calendar.
              </p>
            )}
          </section>
        ) : (
          <>
            <section className={styles.settingsBlock}>
              <h2 className={styles.blockTitle}>Shift</h2>
              <ShiftFactsPanel shift={review.shift} />
            </section>

            <div
              className={
                review.status === "present"
                  ? `${styles.evidencePanel} ${styles.evidencePanelPresent}`
                  : styles.evidencePanel
              }
            >
              <span className={styles.panelLabel}>
                {review.status === "present"
                  ? "Handover on record"
                  : "Evidence of absence"}
              </span>
              <p className={styles.trace}>
                <span className={styles.traceGlyph} aria-hidden="true">
                  ⌕
                </span>{" "}
                searched Documents for &ldquo;{review.expectedRecord}&rdquo; at{" "}
                {review.searchedAt} <span className={styles.traceArrow}>→</span>{" "}
                {review.status === "present" ? (
                  <span className={styles.present}>
                    {review.matchCount}{" "}
                    {review.matchCount === 1 ? "result" : "results"}
                  </span>
                ) : (
                  <span className={styles.missing}>0 results</span>
                )}
              </p>
              <p className={styles.traceNote}>
                {review.status === "present"
                  ? "matches found · the agent proposes nothing for this shift."
                  : "matches: [] · deterministic query against the live document index."}
              </p>
            </div>

            {review.status === "present" ? (
              <div className={styles.silentPanel}>
                <div className={styles.silentHead}>
                  <span className={styles.silentTitle}>
                    Handover present. No action.
                  </span>
                </div>
                <p className={styles.silentBody}>
                  The handover for this shift already exists in Documents, so the
                  detector emits no event and the agent stays silent.
                </p>
              </div>
            ) : (
              <>
                <section className={styles.settingsBlock}>
                  <h2 className={styles.blockTitle}>Detector</h2>
                  <ul className={styles.checkList}>
                    <li className={styles.checkRow}>
                      <span className={styles.checkMain}>
                        <span
                          className={
                            review.detectorFired
                              ? styles.checkReady
                              : styles.checkWarning
                          }
                          aria-hidden="true"
                        >
                          {review.detectorFired ? "●" : "▲"}
                        </span>
                        <span className={styles.checkLabel}>
                          Deterministic detector
                        </span>
                      </span>
                      <span className={styles.checkDetail}>
                        {review.detectorFired
                          ? "emitted the absence event"
                          : "did not emit — the job would stay quiet at this instant"}
                      </span>
                    </li>
                    <li className={styles.checkRow}>
                      <span className={styles.checkMain}>
                        <span className={styles.checkReady} aria-hidden="true">
                          ●
                        </span>
                        <span className={styles.checkLabel}>Event id</span>
                      </span>
                      <span className={styles.checkDetail}>{review.eventId}</span>
                    </li>
                  </ul>
                </section>

                <section className={styles.settingsBlock}>
                  <h2 className={styles.blockTitle}>
                    Open work orders ({review.workOrders.length})
                  </h2>
                  {review.workOrders.length === 0 ? (
                    <p className={styles.blockNote}>
                      No open work orders. A handover would say so rather than
                      invent work.
                    </p>
                  ) : (
                    <ul className={styles.rowList}>
                      {review.workOrders.map((order, index) => (
                        <li key={`${order.id ?? order.title}-${index}`} className={styles.row}>
                          <span className={styles.rowMain}>
                            {order.id ? (
                              <span className={styles.orderId}>{order.id}</span>
                            ) : null}
                            <span className={styles.rowText}>{order.title}</span>
                          </span>
                          {order.assignee || order.status ? (
                            <span className={styles.rowAside}>
                              {[order.status, order.assignee]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className={styles.settingsBlock}>
                  <h2 className={styles.blockTitle}>
                    Channel since shift start ({review.messages.length})
                  </h2>
                  {review.messages.length === 0 ? (
                    <p className={styles.blockNote}>
                      No messages since the shift opened.
                    </p>
                  ) : (
                    <ul className={styles.rowList}>
                      {review.messages.map((message, index) => (
                        <li key={index} className={styles.row}>
                          <span className={styles.rowMain}>
                            <span className={styles.bullet} aria-hidden="true">
                              •
                            </span>
                            <span className={styles.rowText}>{message.text}</span>
                          </span>
                          <span className={styles.rowAside}>
                            {[message.author, message.at]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className={styles.settingsBlock}>
                  <h2 className={styles.blockTitle}>Approval</h2>
                  <p className={styles.blockNote}>
                    The proposal and the decision live in the operations channel.
                    This surface has no Approve button on purpose: a second write
                    path would bypass the boundary that checks the Auth0 scope and
                    applies the idempotency key.
                  </p>
                </section>
              </>
            )}
          </>
        )}

        <p className={styles.pageNote}>
          Live read. Every line above came from the workspace the detector
          searched — no fixtures on this page.
        </p>
      </div>
    </ConsoleShell>
  );
}

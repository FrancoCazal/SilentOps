import type { Metadata } from "next";
import { ConsoleShell } from "@/components/console/console-shell";
import {
  CHANNEL,
  FACILITY,
  detector,
  guardrails,
  shifts,
} from "@/components/handover/handover-data";
import { requireConsoleSession } from "@/lib/server/console-guard";
import { configGroups } from "@/lib/server/console-config";
import styles from "@/components/console/console.module.css";

/**
 * Control tower · Settings — what this deployment is configured to do.
 *
 * READ-ONLY BY DESIGN. Nothing on this page writes: no form, no toggle, no
 * action. Shift windows, detector parameters and guardrails are properties of
 * the deployment, and a browser control that could change one is a browser
 * control that could switch a safety property off.
 *
 * Credentials are reported by `console-config.ts` as states only — never values,
 * prefixes or lengths. The page is behind the console gate regardless.
 */
export const metadata: Metadata = {
  title: "Settings — SilentOps control tower",
  description: "Detector, boundary and integration configuration.",
};

export const dynamic = "force-dynamic";

const stateClass = {
  ready: styles.checkReady,
  missing: styles.checkMissing,
  warning: styles.checkWarning,
} as const;

const stateGlyph = {
  ready: "●",
  missing: "○",
  warning: "▲",
} as const;

export default async function SettingsPage() {
  await requireConsoleSession("/console/settings");
  const groups = configGroups();

  return (
    <ConsoleShell active="settings">
      <div className={styles.subhead}>
        <div className={styles.subheadText}>
          <h1 className={styles.subheadTitle}>Settings</h1>
          <p className={styles.subheadMeta}>
            What this deployment is configured to do. Read-only — changes go
            through the environment, not the browser.
          </p>
        </div>
      </div>

      <div className={styles.pageBody}>
        <section className={styles.settingsBlock}>
          <h2 className={styles.blockTitle}>Facility</h2>
          <dl className={styles.factList}>
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Hub</dt>
              <dd className={styles.factValue}>{FACILITY}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Operations channel</dt>
              <dd className={styles.factValueMono}>{CHANNEL}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.settingsBlock}>
          <h2 className={styles.blockTitle}>Shifts</h2>
          <ul className={styles.rowList}>
            {shifts.map((shift) => (
              <li key={shift.name} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.orderId}>{shift.name}</span>
                  <span className={styles.rowText}>{shift.window}</span>
                </span>
                <span className={styles.rowAside}>{shift.roster}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.settingsBlock}>
          <h2 className={styles.blockTitle}>Detector</h2>
          <p className={styles.blockNote}>
            Deterministic. No model is involved in deciding whether a handover is
            missing.
          </p>
          <dl className={styles.factList}>
            {detector.map((item) => (
              <div key={item.label} className={styles.fact}>
                <dt className={styles.factLabel}>{item.label}</dt>
                <dd className={styles.factValue}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {groups.map((group) => (
          <section key={group.title} className={styles.settingsBlock}>
            <h2 className={styles.blockTitle}>{group.title}</h2>
            <p className={styles.blockNote}>{group.note}</p>
            <ul className={styles.checkList}>
              {group.checks.map((check) => (
                <li key={check.label} className={styles.checkRow}>
                  <span className={styles.checkMain}>
                    <span
                      className={stateClass[check.state]}
                      aria-hidden="true"
                    >
                      {stateGlyph[check.state]}
                    </span>
                    <span className={styles.checkLabel}>{check.label}</span>
                  </span>
                  <span className={styles.checkDetail}>{check.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className={styles.settingsBlock}>
          <h2 className={styles.blockTitle}>Guardrails</h2>
          <p className={styles.blockNote}>
            Properties of the system, not preferences. They are listed here so
            they can be checked, not changed.
          </p>
          <ul className={styles.guardList}>
            {guardrails.map((rule) => (
              <li key={rule} className={styles.guardItem}>
                <span className={styles.guardMark} aria-hidden="true">
                  ✓
                </span>
                <span className={styles.rowText}>{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className={styles.pageNote}>
          Credential states above are reported as configured or not. No key
          value, prefix or length is ever sent to this page.
        </p>
      </div>
    </ConsoleShell>
  );
}

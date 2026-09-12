import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalStates } from "@/components/landing/approval-states";
import styles from "@/components/landing/landing.module.css";

/**
 * SilentOps commercial site — the front door of this app.
 *
 * SilentOps ships as a Slack agent: there is no web login and no separate
 * console to sign into. Every call to action on this page stays on the page —
 * the approval card is previewed here instead of linked to.
 *
 * Copy is English to match SILENTOPS.md, which is the source of truth for the
 * product's claims. Spanish identifiers from the demo workspace (the channel
 * name, the facility, the expected document name) are left verbatim: they are
 * records, not prose.
 *
 * The dark theme is scoped to this route through `landing.module.css` so the
 * light tokens in `globals.css` (used by /kit-demo and /voice) stay untouched.
 *
 * Design source: "Console approval states mockup/SilentOps Landing.dc.html".
 */

export const metadata: Metadata = {
  title: "SilentOps — Continuity for critical cold-chain operations",
  description:
    "SilentOps detects when a handover is missing at the end of a shift, gathers sourced evidence and proposes the reassignment in Slack. A human approves before anything is written.",
};

const steps = [
  {
    number: "01",
    title: "Detect",
    body: "At shift close, a deterministic check searches for the handover document that should exist.",
  },
  {
    number: "02",
    title: "Gather evidence",
    body: "If it is missing, it collects sourced signals from the channel and the open work orders.",
  },
  {
    number: "03",
    title: "Propose",
    body: "It drafts the handover and the work-order reassignment, with a source on every claim.",
  },
  {
    number: "04",
    title: "A human approves",
    body: "Nothing is written until the outgoing supervisor approves it.",
  },
] as const;

/** Widths of the placeholder customer marks, in pixels. */
const logoWidths = [118, 100, 130, 108] as const;

export default function Landing() {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="SilentOps home">
          <span className={styles.brandDot} aria-hidden="true" />
          <span className={styles.brandName}>SilentOps</span>
        </Link>
        <nav className={styles.navLinks} aria-label="Main navigation">
          <a className={styles.navLink} href="#how">
            How it works
          </a>
          <a className={styles.navLink} href="#approval">
            The approval
          </a>
          <a className={styles.navLink} href="#trust">
            Trust
          </a>
          <a className={styles.navLink} href="#pricing">
            Pricing
          </a>
          <a className={styles.navLinkStrong} href="/console">
            Control tower
          </a>
          <a className={styles.buttonPrimarySm} href="#approval">
            See the card
          </a>
        </nav>
      </header>

      <main>
        <section className={styles.hero}>
          <span className={styles.eyebrowPill}>Operational continuity</span>
          <h1 className={styles.heroTitle}>
            The proof is not what was said. It is what nobody wrote down.
          </h1>
          <p className={styles.heroLead}>
            SilentOps detects when a handover is missing at the end of a shift,
            gathers sourced evidence and proposes the reassignment. A human
            approves before anything is written.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.buttonPrimary} href="#approval">
              See the approval card
            </a>
            <a className={styles.buttonGhost} href="#how">
              How it works
            </a>
          </div>

          <div className={styles.window}>
            <div className={styles.windowBar}>
              <span className={styles.windowDot} aria-hidden="true" />
              <span className={styles.windowDot} aria-hidden="true" />
              <span className={styles.windowDot} aria-hidden="true" />
              <span className={styles.windowTitle}>
                #operaciones-hub-frio · Hub Frío Norte
              </span>
            </div>
            <div className={styles.windowBody}>
              <div className={styles.ledgerRow}>
                <span className={styles.ledgerLabel}>
                  06:00 — Handover: <span className={styles.missing}>missing</span>
                </span>
              </div>
              <p className={styles.trace}>
                <span className={styles.traceGlyph} aria-hidden="true">
                  ⌕
                </span>{" "}
                searched Documents for &ldquo;Handover Noche&rdquo; →{" "}
                <span className={styles.missing}>0 results</span>
              </p>
              <p className={styles.windowNote}>
                Ana is closing her shift with 3 open work orders and no
                handover; I will prepare the document and reassign them to
                Bruno.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.logos} aria-label="Adoption">
          <span className={styles.logosLabel}>
            In use across continuous guard operations
          </span>
          <div className={styles.logosRow} aria-hidden="true">
            {logoWidths.map((width, index) => (
              <span
                key={index}
                className={styles.logoMark}
                style={{ width: `${width}px` }}
              />
            ))}
          </div>
        </section>

        <section id="how" className={styles.sectionAlt}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>How it works</span>
              <h2 className={styles.sectionTitle}>
                From an absence to an approval, in four steps
              </h2>
            </div>
            <ol className={styles.steps}>
              {steps.map((step) => (
                <li key={step.number} className={styles.step}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {step.number}
                  </span>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepBody}>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={`${styles.container} ${styles.split}`}>
            <div className={styles.splitCopy}>
              <span className={styles.eyebrow}>Evidence of absence</span>
              <h2 className={styles.sectionTitleSm}>
                An empty result, stated explicitly
              </h2>
              <p className={styles.sectionBody}>
                The central proof is never a blank space. SilentOps records
                exactly what it searched for, when, and how many results came
                back — so an absence is as auditable as any other data point.
              </p>
            </div>
            <div className={styles.evidenceCard}>
              <p className={styles.trace}>
                <span className={styles.traceGlyph} aria-hidden="true">
                  ⌕
                </span>{" "}
                searched Documents for &ldquo;Handover Noche 2026-09-12&rdquo; at
                05:45 <span className={styles.traceArrow}>→</span>{" "}
                <span className={styles.missing}>0 results</span>
              </p>
              <p className={styles.traceNote}>
                matches: [] · deterministic query, no match in the shift&rsquo;s
                document index.
              </p>
              <hr className={styles.rule} />
              <p className={`${styles.trace} ${styles.tracePresent}`}>
                <span className={styles.traceArrow} aria-hidden="true">
                  ⌕
                </span>{" "}
                same search, a shift whose handover is already there{" "}
                <span className={styles.traceArrow}>→</span> 1 result
              </p>
              <p className={styles.traceNote}>
                SilentOps stays quiet when there is nothing to do.
              </p>
            </div>
          </div>
        </section>

        <section id="approval" className={styles.sectionAlt}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>The approval</span>
              <h2 className={styles.sectionTitle}>
                It lives in the operations channel, not in another tab
              </h2>
              <p className={styles.sectionBody}>
                You do not approve in a dashboard. SilentOps posts the proposal
                in the same thread where the shift is already coordinated, and
                the decision is recorded there. The{" "}
                <a href="/console">control tower</a> is for reviewing what
                happened — never for deciding it.
              </p>
            </div>
            <ApprovalStates />
          </div>
        </section>

        <section id="trust" className={styles.section}>
          <div className={styles.trust}>
            <span className={styles.eyebrow}>Trust</span>
            <h2 className={styles.sectionTitleSm}>
              SilentOps never controls equipment or decides safety
            </h2>
            <p className={styles.sectionBody}>
              It prepares a sourced handover for the responsible human to
              approve. No action is written without that approval — there is
              always a record of who approved what, and when.
            </p>
          </div>
        </section>

        <section id="pricing" className={styles.pricingSection}>
          <div className={styles.pricingCard}>
            <h2 className={styles.pricingTitle}>
              Per-hub pricing, based on shift volume
            </h2>
            <p className={styles.pricingBody}>
              SilentOps installs into the operations channel you already use and
              reads your own work orders. No migration, and no extra account to
              administer.
            </p>
            <a className={styles.buttonPrimary} href="#approval">
              See the approval loop
            </a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.footerCopy}>
          © 2026 SilentOps ·{" "}
          <a className={styles.footerLink} href="/console">
            Control tower
          </a>
        </span>
        <span className={styles.footerNote}>
          SilentOps never controls equipment or decides safety. It prepares a
          sourced handover for the responsible human to approve.
        </span>
      </footer>
    </div>
  );
}

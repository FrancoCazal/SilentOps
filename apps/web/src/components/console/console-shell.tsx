"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CHANNEL, FACILITY } from "@/components/handover/handover-data";
import styles from "./console.module.css";

/**
 * Chrome shared by every control-tower route: sidebar, topbar, footer.
 *
 * A client component because sign-out and nav state live here, but its children
 * may be server-rendered — History and Settings pass server components straight
 * through.
 *
 * It performs no access check. Each page calls `requireConsoleSession()` on the
 * server before rendering this.
 */

export type ConsoleSection = "shift" | "history" | "settings";

const sections: readonly { id: ConsoleSection; label: string; href: string }[] = [
  { id: "shift", label: "Shift", href: "/console" },
  { id: "history", label: "History", href: "/console/history" },
  { id: "settings", label: "Settings", href: "/console/settings" },
];

export function ConsoleShell({
  active,
  toolbar,
  badge = "Sample data · read-only",
  notice,
  children,
}: {
  active: ConsoleSection;
  /** Right-hand side of the topbar; the Shift view puts its clock here. */
  toolbar?: ReactNode;
  /** Provenance marker. Live routes override the sample-data default. */
  badge?: ReactNode;
  /** Banner under the topbar, for why a view is degraded or synthetic. */
  notice?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/console-session", { method: "DELETE" });
      router.replace("/access");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand} aria-label="SilentOps home">
          <span className={styles.brandDot} aria-hidden="true" />
          <span className={styles.brandName}>SilentOps</span>
        </Link>

        <nav className={styles.sideNav} aria-label="Operations">
          <span className={styles.sideLabel}>Operations</span>
          {sections.map((section) => {
            const current = section.id === active;
            return (
              <Link
                key={section.id}
                href={section.href}
                className={current ? styles.sideItemActive : styles.sideItem}
                aria-current={current ? "page" : undefined}
              >
                <span
                  className={current ? styles.sideDotActive : styles.sideDot}
                  aria-hidden="true"
                />
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sideUser}>
          <span className={styles.avatar} aria-hidden="true">
            A
          </span>
          <span className={styles.sideUserText}>
            <span className={styles.sideUserName}>Ana</span>
            <span className={styles.sideUserRole}>Outgoing supervisor</span>
          </span>
          <button
            type="button"
            className={styles.signOut}
            onClick={signOut}
            disabled={signingOut}
          >
            {signingOut ? "…" : "Sign out"}
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <span className={styles.facility}>{FACILITY}</span>
            <span className={styles.topDivider} aria-hidden="true">
              ·
            </span>
            <span className={styles.channel}>{CHANNEL}</span>
          </div>
          <div className={styles.topbarRight}>
            <span className={styles.demoBadge}>{badge}</span>
            {toolbar}
          </div>
        </header>

        {notice ? <div className={styles.notice}>{notice}</div> : null}

        {children}

        <footer className={styles.footer}>
          SilentOps never controls equipment or decides safety. It prepares a
          sourced handover for the responsible human to approve.
        </footer>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FACILITY } from "@/components/handover/handover-data";
import styles from "@/components/access/access.module.css";

/**
 * Access page for the control tower.
 *
 * TWO DELIBERATE DEPARTURES FROM THE MOCKUP, both about not lying to the user:
 *
 * 1. The mockup asks for a work email and a password. SilentOps has no user
 *    accounts — approval identity comes from Slack, and writes are authorized by
 *    an Auth0 service scope. A per-user password field would imply an identity
 *    model that does not exist, so this asks for the hub's access code, which is
 *    what the server actually verifies. Layout and styling are unchanged.
 *
 * 2. The mockup's "Ingresar" button is a link straight into the app. Here the
 *    code is POSTed to /api/console-session, which verifies it server-side and
 *    sets an HttpOnly session cookie. A gate that the browser could talk its way
 *    past would be decoration.
 *
 * The access request tab does not pretend to deliver anything — see its
 * confirmation copy.
 */

type Mode = "signin" | "request";

export default function AccessPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/console-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (response.ok) {
        // Server sets the cookie; refresh so the guarded route re-evaluates.
        router.replace("/console");
        router.refresh();
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(payload.error ?? "Could not sign in. Try again.");
    } catch {
      setError("Could not reach the server. Check that the app is running.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandDot} aria-hidden="true" />
          <span className={styles.brandName}>SilentOps</span>
        </Link>
      </header>

      <main className={styles.main}>
        <div className={styles.column}>
          <div className={styles.tabs} role="group" aria-label="Access mode">
            <button
              type="button"
              className={mode === "signin" ? styles.tabActive : styles.tab}
              aria-pressed={mode === "signin"}
              onClick={() => setMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "request" ? styles.tabActive : styles.tab}
              aria-pressed={mode === "request"}
              onClick={() => setMode("request")}
            >
              Request access
            </button>
          </div>

          {mode === "signin" ? (
            <form className={styles.card} onSubmit={signIn}>
              <div className={styles.cardHead}>
                <h1 className={styles.cardTitle}>Sign in to your hub</h1>
                <p className={styles.cardSub}>{FACILITY} · Night shift</p>
              </div>

              <div className={styles.fields}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Hub access code</span>
                  <input
                    className={styles.input}
                    type="password"
                    name="code"
                    value={code}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
              </div>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}

              <button
                className={styles.submit}
                type="submit"
                disabled={busy || code.length === 0}
              >
                {busy ? "Checking…" : "Sign in"}
              </button>

              <p className={styles.footnote}>
                The control tower is a read-only shift review. Approvals happen
                in Slack, never here.
              </p>
            </form>
          ) : (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <h1 className={styles.cardTitle}>Request access</h1>
                <p className={styles.cardSub}>
                  We coordinate the account with your hub supervisor.
                </p>
              </div>

              {requestSent ? (
                <p className={styles.notice} role="status">
                  Nothing was sent. This build has no request inbox yet — reach
                  your hub supervisor directly, and they can share the access
                  code.
                </p>
              ) : (
                <>
                  <div className={styles.fields}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Full name</span>
                      <input
                        className={styles.input}
                        type="text"
                        name="name"
                        autoComplete="name"
                        placeholder="Ana Duarte"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Work email</span>
                      <input
                        className={styles.input}
                        type="email"
                        name="email"
                        autoComplete="email"
                        placeholder="ana@example.com"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Hub / site</span>
                      <input
                        className={styles.input}
                        type="text"
                        name="hub"
                        placeholder={FACILITY}
                      />
                    </label>
                  </div>

                  <button
                    className={styles.submit}
                    type="button"
                    onClick={() => setRequestSent(true)}
                  >
                    Send request
                  </button>
                </>
              )}
            </div>
          )}

          <p className={styles.disclaimer}>
            SilentOps never controls equipment or decides safety. It prepares a
            sourced handover for the responsible human to approve.
          </p>
        </div>
      </main>
    </div>
  );
}

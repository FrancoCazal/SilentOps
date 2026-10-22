import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccessForm } from "@/components/access/access-form";
import { COOKIE_NAME, consoleAccess, gateIsConfigured } from "@/lib/server/console-session";

/**
 * Access route for the control tower.
 *
 * Resolved on the server so the browser is never the authority: with a valid
 * session there is nothing to sign into, and with no code configured the tower
 * is the public sample demo, so both go straight to /console. Only a gate with a
 * code and no session renders the form.
 */
export const metadata: Metadata = {
  title: "Sign in — SilentOps",
  description: "Access the SilentOps control tower for your hub.",
};

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const store = await cookies();
  if (consoleAccess(store.get(COOKIE_NAME)?.value) !== "denied") {
    redirect("/console");
  }
  return <AccessForm configured={gateIsConfigured()} />;
}

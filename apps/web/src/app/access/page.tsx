import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccessForm } from "@/components/access/access-form";
import { COOKIE_NAME, gateIsConfigured, sessionIsValid } from "@/lib/server/console-session";

/**
 * Access route for the control tower.
 *
 * Resolves two things on the server so the browser is never the authority:
 * whether a session already exists (skip straight to the tower) and whether the
 * gate has a code at all (tell the operator up front instead of after a failed
 * attempt).
 */
export const metadata: Metadata = {
  title: "Sign in — SilentOps",
  description: "Access the SilentOps control tower for your hub.",
};

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const store = await cookies();
  if (sessionIsValid(store.get(COOKIE_NAME)?.value)) {
    redirect("/console");
  }
  return <AccessForm configured={gateIsConfigured()} />;
}

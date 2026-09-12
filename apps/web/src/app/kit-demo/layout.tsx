import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "@copilotkit/react-core/v2/styles.css";

/**
 * The inherited CopilotKit incident sample used to be the app's root route.
 * SilentOps' own site took `/`, so the sample moved here unchanged.
 *
 * This layout owns everything the sample needs and the SilentOps site does not:
 * the CopilotKit provider (which opens a runtime connection on mount) and the
 * CopilotKit stylesheet. Its page is a client component and cannot export
 * metadata itself, so the sample's original title lives here too.
 */
export const metadata: Metadata = {
  title: "Incident assistant — Agents, Everywhere",
  description: "Pick an incident, ask your assistant, and add a follow-up.",
};

export default function KitDemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}

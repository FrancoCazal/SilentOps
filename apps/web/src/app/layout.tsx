import type { Metadata } from "next";
import "./globals.css";

/**
 * Root layout.
 *
 * The CopilotKit provider deliberately does NOT live here. It mounts a runtime
 * connection and issues a runtime-info request as soon as it renders, which the
 * SilentOps site at `/` neither needs nor should pay for — and which fails
 * loudly when no model key is configured. It is mounted per-route instead, in
 * `kit-demo/layout.tsx`, alongside the CopilotKit stylesheet.
 */
export const metadata: Metadata = {
  title: "SilentOps — Continuidad operativa para guardias críticas",
  description:
    "SilentOps detecta cuando falta un handover al cierre de turno, reúne evidencia con fuente y propone la reasignación en Slack.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

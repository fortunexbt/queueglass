import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Queueglass — Simulated Queue Control Plane",
  description: "A deterministic, seed-replayable discrete-event simulator using only synthetic local data.",
  keywords: ["simulation", "discrete event", "deterministic", "queueing", "systems engineering"],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

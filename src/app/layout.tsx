import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";

import "./globals.css";

const body = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const description =
  "Find the step that limits your team's workflow. Replay real arrivals from your tracker through your steps and see when the backlog clears, and whether one more unit of capacity would clear it sooner.";

export const metadata: Metadata = {
  metadataBase: new URL("https://queueglass.vercel.app"),
  title: "queueglass · which step is holding your team up?",
  description,
  openGraph: {
    title: "queueglass",
    description,
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "queueglass", description },
};

export const viewport: Viewport = {
  themeColor: "#0e1113",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}

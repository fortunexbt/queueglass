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
  "A seeded queue simulator. Send simulated work through four steps, watch where it jams, and scrub back through every tick.";

export const metadata: Metadata = {
  metadataBase: new URL("https://queueglass.vercel.app"),
  title: "queueglass · see where work gets stuck",
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

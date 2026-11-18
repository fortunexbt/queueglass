import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";

import "./globals.css";

// One family; the width axis does the work a second display face would.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
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
  themeColor: "#e3e9eb",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}

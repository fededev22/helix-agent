import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Helix — coding agent harness",
  description:
    "Clean-room coding agent inspired by terminal agent workflows: tools, permissions, project instructions, slash commands.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${plexSans.variable} ${plexMono.variable} antialiased`}
        style={
          {
            "--hx-font-sans": "var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif",
            "--hx-font-mono": "var(--font-ibm-plex-mono), ui-monospace, monospace",
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}

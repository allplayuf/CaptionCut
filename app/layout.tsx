import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CaptionCut — TikTok caption editor",
  description:
    "Fast vertical video editor for TikTok, Reels and Shorts with automatic captions that actually work.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}

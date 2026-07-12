import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CaptionCut — AI football montage editor",
  description:
    "AI-powered short-form video editor for football creators: upload raw match clips, auto-cut a TikTok-ready montage, fine-tune it on a real multi-track timeline.",
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

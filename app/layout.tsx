import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://allplaycut.vercel.app"
);

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "CaptionCut",
  title: {
    default: "CaptionCut — Edit video from the transcript",
    template: "%s · CaptionCut",
  },
  description:
    "A focused video editor for cutting from the transcript, creating on-device captions, and exporting polished social video.",
  keywords: [
    "video editor",
    "transcript editor",
    "caption editor",
    "social video",
    "automatic captions",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "CaptionCut",
    title: "CaptionCut — Edit video from the transcript",
    description:
      "Cut from the transcript, create on-device captions, and export the final video.",
  },
  twitter: {
    card: "summary_large_image",
    title: "CaptionCut — Edit video from the transcript",
    description:
      "Cut from the transcript, create on-device captions, and export the final video.",
  },
  category: "technology",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#08090b",
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

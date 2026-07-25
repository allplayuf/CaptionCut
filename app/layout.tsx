import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CaptionCut — klipp videon som text",
  description:
    "En fokuserad videoredigerare för att hitta pauser, klippa i transcriptet och skapa snygga captions.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sv" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}

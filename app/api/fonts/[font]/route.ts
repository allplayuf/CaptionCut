import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const FONT_FILES = {
  "archivo-black": path.join(
    process.cwd(),
    "node_modules",
    "@expo-google-fonts",
    "archivo-black",
    "400Regular",
    "ArchivoBlack_400Regular.ttf"
  ),
  anton: path.join(
    process.cwd(),
    "node_modules",
    "@expo-google-fonts",
    "anton",
    "400Regular",
    "Anton_400Regular.ttf"
  ),
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ font: string }> }
) {
  const { font } = await params;
  const file = FONT_FILES[font as keyof typeof FONT_FILES];
  if (!file) return NextResponse.json({ error: "Font not found" }, { status: 404 });

  try {
    const bytes = await fs.promises.readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "font/ttf",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Font unavailable" }, { status: 404 });
  }
}

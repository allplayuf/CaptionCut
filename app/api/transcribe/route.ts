import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

/**
 * Captions no longer upload audio to a server. This status endpoint remains so
 * older clients and deployment checks get an explicit, privacy-safe answer.
 */
export async function GET() {
  return NextResponse.json(
    {
      provider: "browser-whisper",
      ready: true,
      model: "downloaded by each browser on first use",
      localOnly: true,
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Server transcription is disabled. Reload CaptionCut to use free captions on this device.",
      provider: "browser-whisper",
      localOnly: true,
    },
    { status: 410, headers: CORS_HEADERS }
  );
}

/**
 * Old deployments posted captions to this route. Vercel can redirect an old
 * preview alias to the canonical project domain, which turns that request into
 * a cross-origin preflight. Keep OPTIONS explicit so those cached clients see
 * the migration response above instead of failing at the browser boundary.
 */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

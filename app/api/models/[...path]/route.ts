import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL_PREFIXES = [
  "onnx-community/whisper-tiny/resolve/main/",
  "onnx-community/whisper-base/resolve/main/",
];
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/** Same-origin fallback for browsers or networks that block Hugging Face. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyModelRequest(request, context, false);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyModelRequest(request, context, true);
}

async function proxyModelRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
  head: boolean
) {
  const { path } = await params;
  if (
    !Array.isArray(path) ||
    path.length < 5 ||
    path.some((segment) => !SAFE_SEGMENT.test(segment))
  ) {
    return NextResponse.json({ error: "Invalid model path." }, { status: 400 });
  }

  const pathname = path.join("/");
  if (!MODEL_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.json({ error: "Model is not allowed." }, { status: 404 });
  }

  const upstreamUrl = `https://huggingface.co/${path
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  const upstream = await fetch(upstreamUrl, {
    method: head ? "HEAD" : "GET",
    redirect: "follow",
    headers: {
      Accept: request.headers.get("accept") ?? "*/*",
      ...(request.headers.get("range")
        ? { Range: request.headers.get("range") as string }
        : {}),
    },
  });

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: "The caption model file is temporarily unavailable." },
      { status: upstream.status }
    );
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of [
    "accept-ranges",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new NextResponse(head ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

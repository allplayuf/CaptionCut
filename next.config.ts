import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages resolve real binary paths at runtime (ffmpeg.exe etc.) and
  // must not be bundled by the compiler.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  // Local media can be very large and must never be copied into a Function
  // bundle by output-file tracing. Deployed media lives in Vercel Blob.
  outputFileTracingExcludes: {
    "/api/*": ["./data/**/*", "./next.config.ts"],
  },
};

export default nextConfig;

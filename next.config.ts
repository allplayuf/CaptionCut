import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // These packages resolve real binary paths at runtime (ffmpeg.exe etc.) and
  // must not be bundled by the compiler.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  // Local media can be very large and must never be copied into a Function
  // bundle by output-file tracing. Deployed media lives in Vercel Blob.
  outputFileTracingExcludes: {
    "/api/*": ["./data/**/*", "./next.config.ts"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

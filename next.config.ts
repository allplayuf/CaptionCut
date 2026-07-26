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
  // Vercel's Linux functions do not provide system fonts. libass needs a real
  // font file to burn captions into exported video, so ship one explicitly.
  outputFileTracingIncludes: {
    "/api/export": [
      "./node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf",
      "./node_modules/@expo-google-fonts/anton/400Regular/Anton_400Regular.ttf",
    ],
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

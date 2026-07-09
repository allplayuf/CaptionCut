import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages resolve real binary paths at runtime (ffmpeg.exe etc.) and
  // must not be bundled by the compiler.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
};

export default nextConfig;

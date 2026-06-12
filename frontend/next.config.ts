import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS
    ? [process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS]
    : [],
};

export default nextConfig;

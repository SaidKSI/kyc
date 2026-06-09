import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS
    ? [process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS]
    : [],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    const backendUrl = process.env.CODESHEEP_BACKEND_URL || "http://localhost:3000";
    return [
      {
        source: "/api/company/:path*",
        destination: `${backendUrl}/api/company/:path*`,
      },
    ];
  },
};

export default nextConfig;

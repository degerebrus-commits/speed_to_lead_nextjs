import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The lead intake route talks to Postgres via Prisma, so it must run on the
  // Node.js runtime rather than the Edge runtime.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;

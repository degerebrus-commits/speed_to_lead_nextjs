import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The lead intake route talks to Postgres via Prisma, so it must run on the
  // Node.js runtime rather than the Edge runtime.
  serverExternalPackages: ["@prisma/client"],
  /**
   * Emits .next/standalone: the server plus only the node_modules it actually
   * imports. The runtime image is then a few hundred megabytes rather than
   * carrying a full install, and nothing devDependency-shaped ships to
   * production.
   */
  output: "standalone",
};

export default nextConfig;

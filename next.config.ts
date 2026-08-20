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
  /**
   * Hosts allowed to submit server actions.
   *
   * Next compares the Origin header against the host as a CSRF guard. Behind a
   * tunnel or a reverse proxy the two disagree, so every server action is
   * rejected - the demo form submits and nothing happens, with no error the
   * visitor can see. Listing the tunnel host makes the form work through it
   * while keeping the guard for everything else.
   */
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3100",
        "desktop-vlqd8rl-1.tail586fe5.ts.net",
      ],
    },
  },
};

export default nextConfig;

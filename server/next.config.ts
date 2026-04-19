import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Point to monorepo root so Turbopack resolves hoisted deps correctly.
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp", "archiver"],
  output: "standalone",
};

export default nextConfig;

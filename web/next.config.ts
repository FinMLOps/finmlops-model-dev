import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone", // a self-contained server for the Docker image (Cloud Run)
};

export default nextConfig;

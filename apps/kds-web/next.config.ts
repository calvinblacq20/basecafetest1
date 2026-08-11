import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@base-cafe/contracts",
    "@base-cafe/database",
    "@base-cafe/domain",
    "@base-cafe/integrations",
    "@base-cafe/ui",
    "@base-cafe/web-client",
  ],
};

export default nextConfig;

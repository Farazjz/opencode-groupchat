import type { NextConfig } from "next";

/**
 * Local/dev build keeps the sandbox defaults.
 * GitHub Pages build (NEXT_PAGES_BUILD=1) switches to a fully static export
 * under the project-site basePath (/opencode-groupchat).
 */
const isPages = process.env.NEXT_PAGES_BUILD === "1";

const nextConfig: NextConfig = isPages
  ? {
      output: "export",
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || "/opencode-groupchat",
      trailingSlash: true,
      images: { unoptimized: true },
      typescript: { ignoreBuildErrors: true },
      reactStrictMode: false,
    }
  : {
      output: "standalone",
      typescript: { ignoreBuildErrors: true },
      reactStrictMode: false,
    };

export default nextConfig;

const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    "@provacx/api",
    "@provacx/database",
    "@provacx/shared",
    "@provacx/ui",
    "@provacx/drawing-engine",
    "@provacx/boq-engine",
    "@provacx/document-editor",
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
      };
    } else {
      config.externals = [...(config.externals || []), { canvas: "canvas" }];
    }
    return config;
  },
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
  },
  webpack: (config, { isServer }) => {
    // Handle canvas module for Konva (required for SSR compatibility)
    if (!isServer) {
      // Client-side: canvas is not needed, stub it out
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
      };
    } else {
      // Server-side: externalize canvas to avoid bundling issues
      config.externals = [...(config.externals || []), { canvas: "canvas" }];
    }
    return config;
  },
};

module.exports = nextConfig;

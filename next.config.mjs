/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  swcMinify: false,
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin", "@grpc/grpc-js", "undici"],
  },
  transpilePackages: ["undici"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), "@grpc/grpc-js", "undici"];
    }
    return config;
  },
};
export default nextConfig;
// vercel fix 2026
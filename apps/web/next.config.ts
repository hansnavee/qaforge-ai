import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@qaforge/shared'],
  reactStrictMode: true,
  // Standalone only for Docker images; Vercel uses its own Next builder
  ...(process.env.DOCKER_BUILD === '1' ? { output: 'standalone' as const } : {}),
};

export default nextConfig;

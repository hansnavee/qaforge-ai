import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@qaforge/shared'],
  reactStrictMode: true,
  output: 'standalone',
};

export default nextConfig;

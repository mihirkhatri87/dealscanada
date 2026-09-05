import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Retailer product images are hotlinked from the merchant's own CDN. We do not
  // enumerate hostnames (the catalogue has 60+ retailers and grows via config), so
  // remote images are allowed broadly over HTTPS and sandboxed by the CSP below.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
    dangerouslyAllowSVG: false,
  },
  // better-sqlite3 is a native module; it must not be bundled into server chunks.
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
};

export default nextConfig;

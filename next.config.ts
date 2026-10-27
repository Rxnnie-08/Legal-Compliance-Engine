import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // keep native / Node-only packages out of the bundler
  serverExternalPackages: ['pg', 'bcryptjs', 'unpdf'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;

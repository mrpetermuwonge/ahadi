const isProd = process.env.NODE_ENV === 'production';

/**
 * Content Security Policy: the browser only runs scripts, styles and images from Ahadi itself, never inside
 * another site's frame. 'unsafe-inline' is needed for Next.js's own bootstrap scripts; 'unsafe-eval' only in
 * development (hot reload). Payment pages of providers open as a full redirect, which CSP does not restrict.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The browser tests run a second copy of the app with its own build folder (see scripts/e2e.mjs).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Runs src/instrumentation.ts at server start (built-in job scheduler, see INTERNAL_CRON).
    instrumentationHook: true,
    // These run only on the server and must not be bundled.
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'pg', 'exceljs', 'pdf-lib', 'qrcode'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Browsers remember to use HTTPS only (production, served over HTTPS).
          ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  // Replaces the deprecated `next-transpile-modules` package.
  transpilePackages: ['oxigraph'],
};

module.exports = nextConfig;

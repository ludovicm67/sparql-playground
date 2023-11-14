const withTM = require('next-transpile-modules')(['oxigraph']);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
};

module.exports = withTM(nextConfig);

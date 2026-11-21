import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  distDir: process.env.PACECLUB_BUILD_DIR || '.next',
};
export default config;

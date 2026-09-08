/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Disable image optimization for static serving
  images: { unoptimized: true },
};
export default nextConfig;

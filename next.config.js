/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keeps local/container QA builds stable on machines that report very high CPU counts.
    cpus: 1
  }
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output standalone build for Docker
  output: "standalone",

  // Strict mode for catching React issues early
  reactStrictMode: true,

  // Transpile the shared package
  transpilePackages: ["@hivechat/shared"],
};

module.exports = nextConfig;

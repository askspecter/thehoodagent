/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @pons/engine is a local file: dependency written in CommonJS. Next needs to
  // transpile it rather than treat it as a prebuilt ESM package.
  transpilePackages: ["@pons/engine"],
};

export default nextConfig;

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The repository root also has a package-lock.json (the Hardhat project), so
  // Next would otherwise walk up and infer the monorepo root as the tracing
  // root. Pinning it to this directory keeps `web/` self-contained, which is
  // what makes the Vercel build (root directory = `web`) deterministic.
  outputFileTracingRoot: here,
};

export default nextConfig;

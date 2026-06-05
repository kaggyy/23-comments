import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  outputFileTracingRoot: join(__dirname, "../.."),
  transpilePackages: ["@comment-tool/shared"]
};

export default nextConfig;

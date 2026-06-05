import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content/index.tsx"),
      formats: ["iife"],
      name: "CommentToolContent",
      fileName: () => "assets/content.js"
    },
    rollupOptions: {
      output: {
        banner:
          "var process = globalThis.process || { env: { NODE_ENV: 'production' } };",
        inlineDynamicImports: true
      }
    }
  }
});

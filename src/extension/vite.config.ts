import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [vue()],
  publicDir: resolve(root, "public"),
  build: {
    outDir: resolve(root, "../../dist/extension"),
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(root, "popup.html") },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "dist-server",
    ssr: "src/server/prod-server.ts",
    target: "node22",
    rollupOptions: {
      output: {
        chunkFileNames: "chunks/[name]-[hash].mjs",
        entryFileNames: "prod-server.mjs",
      },
    },
  },
});

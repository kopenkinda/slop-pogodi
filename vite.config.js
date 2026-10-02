import { defineConfig } from "vite";

export default defineConfig({
  base: "/slop-pogodi/",
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"] },
      },
    },
  },
});

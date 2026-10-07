import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/slop-pogodi/",
  plugins: [
    VitePWA({
      // Let an update take effect after the app closes, never during a round.
      registerType: "prompt",
      includeAssets: [
        "egg.svg",
        "apple-touch-icon-180x180.png",
        "fonts/*.woff2",
      ],
      manifest: {
        id: "/slop-pogodi/",
        name: "Nu, Pogodi! 3D",
        short_name: "Nu, Pogodi!",
        description:
          "A 3D remake of the Elektronika egg-catching handheld.",
        start_url: "/slop-pogodi/",
        scope: "/slop-pogodi/",
        display: "standalone",
        background_color: "#141c24",
        theme_color: "#141c24",
        categories: ["games"],
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"] },
      },
    },
  },
});

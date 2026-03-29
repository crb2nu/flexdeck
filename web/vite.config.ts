import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  base: "./",
  plugins: [solidPlugin()],
  resolve: {
    conditions: ["browser"],
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("/node_modules/solid-js")) return "vendor-solid";
          if (id.includes("/node_modules/@solidjs/router")) return "vendor-router";
          if (id.includes("/node_modules/three")) return "vendor-three";
          if (id.includes("/node_modules/d3")) return "vendor-d3";
          if (id.includes("/node_modules/yaml")) return "vendor-yaml";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});

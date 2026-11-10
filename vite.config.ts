import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "ui",
  plugins: [react()],
  build: {
    outDir: "../dist/management-ui",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["../tests/ui/setup.ts"],
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 开发端口固定 1420（后端 CORS 已放行）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2021", outDir: "dist" },
});

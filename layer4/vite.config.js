import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 3000 matches Layer 2's default CORS_ORIGINS.
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, strictPort: true },
  preview: { port: 3000 },
  build: {
    rollupOptions: {
      output: { manualChunks: { map: ["leaflet", "react-leaflet"], chart: ["recharts"], chain: ["ethers"] } },
    },
  },
});

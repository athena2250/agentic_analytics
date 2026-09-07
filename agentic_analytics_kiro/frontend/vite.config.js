import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// run.sh sets API_PORT/UI_PORT; both fall back to the documented defaults.
const apiPort = process.env.API_PORT || "8000";
const uiPort = Number(process.env.UI_PORT || 5173);
const api = `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: uiPort,
    proxy: {
      "/session": api,
      "/formats": api,
    },
  },
});

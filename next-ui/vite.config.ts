import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { agentsApiPlugin } from "./vite-agents-plugin";

export default defineConfig({
  plugins: [react(), agentsApiPlugin()],
  server: {
    port: 5187,
  },
});

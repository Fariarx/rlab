import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { agentsApiPlugin } from "./vite-agents-plugin";

export default defineConfig({
  plugins: [react(), agentsApiPlugin()],
  server: {
    port: 5187,
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react-vendor", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: "kit-route", test: /src[\\/]components[\\/]kit[\\/]/, priority: 2 },
            { name: "mui-icons-vendor", test: /node_modules[\\/]@mui[\\/]icons-material[\\/]/, priority: 6 },
            { name: "mui-material-vendor", test: /node_modules[\\/]@mui[\\/](material|system|utils|private-theming|styled-engine)[\\/]/, priority: 5 },
            { name: "emotion-vendor", test: /node_modules[\\/]@emotion[\\/]/, priority: 4 },
            { name: "state-vendor", test: /node_modules[\\/](mobx|mobx-react-lite|react-virtuoso)[\\/]/, priority: 2 },
            { name: "vendor", test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});

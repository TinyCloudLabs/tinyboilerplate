import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@tinycloud/web-sdk"],
  },
  server: {
    // 5174 = notes frontend, 5175 = app-starter frontend. Tasks uses 5176.
    port: 5176,
    allowedHosts: true,
    ...(fs.existsSync("./localhost.pem") && {
      https: {
        key: fs.readFileSync("./localhost-key.pem"),
        cert: fs.readFileSync("./localhost.pem"),
      },
    }),
  },
});

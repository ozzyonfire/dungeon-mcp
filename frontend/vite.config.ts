import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendHost = env.BACKEND_HOST ?? "localhost";
  const backendPort = env.BACKEND_PORT ?? "3000";
  const backendProtocol = env.BACKEND_PROTOCOL ?? "http";
  const backendOrigin = `${backendProtocol}://${backendHost}:${backendPort}`;
  const backendWsOrigin = `${backendProtocol === "https" ? "wss" : "ws"}://${backendHost}:${backendPort}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/join": backendOrigin,
        "/act": backendOrigin,
        "/state": backendOrigin,
        "/wait_state": backendOrigin,
        "/observer_state": backendOrigin,
        "/health": backendOrigin,
        "/ws": {
          target: backendWsOrigin,
          ws: true,
        },
      },
    },
  };
});

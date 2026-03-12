import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
const appVersion = process.env.VITE_APP_VERSION ?? process.env.APP_VERSION ?? "dev";
export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
        port: 5173,
        proxy: {
            "/api": "http://127.0.0.1:8080",
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
    test: {
        environment: "jsdom",
        setupFiles: "./src/test/setup.ts",
    },
});

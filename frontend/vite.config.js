import { defineConfig } from "vitest/config";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";
const appVersion = process.env.VITE_APP_VERSION ?? process.env.APP_VERSION ?? "dev";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const backendHost = process.env.BACKEND_HOST ?? "127.0.0.1";
const proxyHost = backendHost === "0.0.0.0" ? "127.0.0.1" : backendHost;
const backendPort = process.env.BACKEND_PORT ?? "8080";
let assetOutputDirectory = "";
export default defineConfig({
    plugins: [
        react(),
        {
            name: "medialyze-precompressed-assets",
            apply: "build",
            configResolved(config) {
                assetOutputDirectory = resolve(config.root, config.build.outDir, "assets");
            },
            closeBundle() {
                // Vite rewrites preload references in generateBundle. Compress only the
                // final bytes on disk, after every chunk transformation has finished.
                for (const fileName of readdirSync(assetOutputDirectory)) {
                    if (!/\.(js|css)$/.test(fileName))
                        continue;
                    const path = resolve(assetOutputDirectory, fileName);
                    const bytes = readFileSync(path);
                    if (bytes.length < 1024)
                        continue;
                    writeFileSync(`${path}.gz`, gzipSync(bytes, { level: 9 }));
                    writeFileSync(`${path}.br`, brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
                }
            },
        },
        {
            name: "medialyze-build-version",
            generateBundle() {
                this.emitFile({
                    type: "asset",
                    fileName: "build-version.json",
                    source: JSON.stringify({ version: appVersion }),
                });
            },
        },
    ],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
        port: 5173,
        fs: {
            allow: [repoRoot],
        },
        proxy: {
            "/api": `http://${proxyHost}:${backendPort}`,
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        chunkSizeWarningLimit: 1_000,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules/zrender")) {
                        return "zrender";
                    }
                    if (id.includes("node_modules/echarts")) {
                        return "echarts";
                    }
                    if (id.includes("node_modules/react") || id.includes("node_modules/react-router")) {
                        return "react-vendor";
                    }
                    if (id.includes("node_modules/i18next")) {
                        return "i18n";
                    }
                    if (id.includes("node_modules/motion") || id.includes("node_modules/framer-motion")) {
                        return "motion";
                    }
                    if (id.includes("node_modules/lucide-react")) {
                        return "icons";
                    }
                    return undefined;
                },
            },
        },
    },
    test: {
        environment: "jsdom",
        maxWorkers: 4,
        setupFiles: "./src/test/setup.ts",
        testTimeout: 15_000,
    },
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "vite";
import { resolve } from "node:path";

describe("Development API proxy", () => {
  it.each(["vite.config.ts", "vite.config.js"])(
    "%s preserves the browser host for exact origin validation",
    async (file) => {
      const loaded = await loadConfigFromFile(
        { command: "serve", mode: "development" },
        resolve(file),
      );
      const rule = loaded?.config.server?.proxy?.["/api"];
      expect(rule).toBeTypeOf("object");
      expect(typeof rule === "object" && rule.changeOrigin).toBe(false);
    },
  );
});

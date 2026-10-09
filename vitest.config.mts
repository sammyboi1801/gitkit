import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shared = {
  setupFiles: ["test/setup.ts"],
  // Real-repo tests start many git processes; CI machines (Windows especially) are slower.
  testTimeout: 30_000,
  hookTimeout: 60_000,
  // No retries: a test that only passes sometimes is a bug to fix, not to hide.
  retry: 0,
};

export default defineConfig({
  test: {
    projects: [
      {
        // Git logic and extension-side code, on real throwaway repos.
        resolve: {
          // Extension-side code imports "vscode"; tests get a scriptable fake instead.
          alias: { vscode: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)) },
        },
        test: { ...shared, name: "node", include: ["test/unit/**/*.test.ts", "test/host/**/*.test.ts"] },
      },
      {
        // Svelte components rendered in a simulated browser.
        plugins: [svelte({ compilerOptions: { css: "injected" } })],
        resolve: { conditions: ["browser"] },
        test: {
          ...shared,
          name: "ui",
          environment: "jsdom",
          include: ["test/ui/**/*.test.ts"],
          setupFiles: [...shared.setupFiles, "test/ui/setup.ts"],
        },
      },
    ],
  },
});

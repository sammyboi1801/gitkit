import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Extension-side code imports "vscode"; tests get a scriptable fake instead.
    alias: { vscode: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Real-repo tests start many git processes; CI machines (Windows especially) are slower.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // No retries: a test that only passes sometimes is a bug to fix, not to hide.
    retry: 0,
  },
});

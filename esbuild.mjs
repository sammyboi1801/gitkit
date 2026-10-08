import * as esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "info",
};

/** @type {esbuild.BuildOptions} */
const extension = {
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
};

/** @type {esbuild.BuildOptions} */
const webview = {
  ...shared,
  entryPoints: { pulse: "webview/pulse/main.ts" },
  outdir: "dist/webview",
  format: "iife",
  platform: "browser",
  target: "es2022",
  mainFields: ["svelte", "browser", "module", "main"],
  conditions: ["svelte", "browser", production ? "production" : "development"],
  plugins: [sveltePlugin({ compilerOptions: { css: "external", dev: !production } })],
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}

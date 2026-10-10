// Writes ThirdPartyNotices.txt: the licence of every npm package esbuild bundles into GitKit.
//   npm run notices      after adding or updating a dependency (a unit test checks it's current)
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The npm packages bundled into dist/, as found by esbuild itself: [name, version, licence][]. */
export async function bundledPackages() {
  const common = { bundle: true, write: false, metafile: true, absWorkingDir: root, logLevel: "silent" };
  const builds = await Promise.all([
    esbuild.build({
      ...common,
      entryPoints: ["src/extension.ts"],
      outfile: "notices-check/extension.js",
      platform: "node",
      format: "cjs",
      external: ["vscode"],
    }),
    esbuild.build({
      ...common,
      entryPoints: { pulse: "webview/pulse/main.ts", map: "webview/map/main.ts", workflow: "webview/workflow/main.ts" },
      outdir: "notices-check",
      platform: "browser",
      format: "iife",
      mainFields: ["svelte", "browser", "module", "main"],
      conditions: ["svelte", "browser", "production"],
      loader: { ".ttf": "file" },
      plugins: [sveltePlugin({ compilerOptions: { css: "external" } })],
    }),
  ]);
  const names = new Set();
  for (const { metafile } of builds) {
    for (const input of Object.keys(metafile.inputs)) {
      const match = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(input);
      if (match) names.add(match[1].replace(/\\/g, "/"));
    }
  }
  return [...names].sort().map((name) => {
    const pkg = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
    return [name, pkg.version, pkg.license];
  });
}

/** Every licence file a package ships (codicons has one for its font and one for its code). */
function licenceTexts(name) {
  const dir = join(root, "node_modules", name);
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying)/i.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").trim());
}

async function main() {
  const rule = "-".repeat(78);
  const sections = (await bundledPackages()).map(([name, version, licence]) =>
    [rule, `${name} ${version} (${licence})`, `https://www.npmjs.com/package/${name}`, "", ...licenceTexts(name)].join(
      "\n",
    ),
  );
  const text = [
    "GitKit includes the following third-party software, bundled into its extension and webviews.",
    "Each is used under the licence shown with it.",
    "",
    ...sections,
    "",
  ].join("\n");
  writeFileSync(join(root, "ThirdPartyNotices.txt"), text);
  console.log(`Wrote ThirdPartyNotices.txt (${sections.length} packages).`);
}

if (process.argv[1] && existsSync(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

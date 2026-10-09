// Screenshots a preview page with headless Edge or Chrome: node scripts/shot.mjs <page> <out.png> [width] [height]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [page, out, width = "1280", height = "900"] = process.argv.slice(2);
const browsers = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browser = browsers.find((b) => existsSync(b));
if (!browser) throw new Error("No Edge or Chrome found for headless screenshots.");
const [file, hash = ""] = page.split("#");
const url = pathToFileURL(resolve(file)).href + (hash ? `#${hash}` : "");
execFileSync(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--virtual-time-budget=3000",
    `--window-size=${width},${height}`,
    `--screenshot=${resolve(out)}`,
    url,
  ],
  { stdio: "ignore" },
);
console.log(`saved ${out}`);

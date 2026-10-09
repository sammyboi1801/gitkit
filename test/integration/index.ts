import { readdirSync } from "node:fs";
import { join } from "node:path";
import Mocha from "mocha";

// Entry point VS Code calls inside the extension host: runs every built *.test.js with mocha.
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 60_000 });
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith(".test.js"))) {
    mocha.addFile(join(__dirname, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} integration test(s) failed`)) : resolve()));
  });
}

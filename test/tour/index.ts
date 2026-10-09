import { join } from "node:path";
import Mocha from "mocha";

// Entry point VS Code calls inside the extension host for the tour (scripts/tour.mjs).
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 15 * 60_000 });
  mocha.addFile(join(__dirname, "tour.test.js"));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} tour check(s) failed`)) : resolve()));
  });
}

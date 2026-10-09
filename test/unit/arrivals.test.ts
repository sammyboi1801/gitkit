import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  arrivalMessage,
  parseArrivalLog,
  readArrivals,
  remoteTips,
  whoText,
  type Arrival,
} from "../../src/git/arrivals";
import { git, makeDivergedClone, write } from "../fixtures/repos";

/** Commits as someone else, in a clone of the remote, and pushes them to main. */
function teammatePushes(remote: string, base: string, who: [string, string], messages: string[]) {
  const clone = join(base, `clone-${who[0].split(" ")[0].toLowerCase()}`);
  git(base, "clone", "-q", remote, clone);
  for (const message of messages) {
    write(clone, `${message}.txt`, message);
    git(clone, "add", "-A");
    git(clone, "-c", `user.name=${who[0]}`, "-c", `user.email=${who[1]}`, "commit", "-q", "-m", message);
  }
  git(clone, "push", "-q", "origin", "HEAD:main");
}

describe("readArrivals", () => {
  it("lists other people's new commits on the remote branches, leaving out your own", async () => {
    const { work, remote } = makeDivergedClone();
    const base = join(work, "..");
    const before = await remoteTips(work, ["origin/main", "origin/nope"]);
    expect([...before.keys()]).toEqual(["origin/main"]);

    teammatePushes(remote, base, ["Alex Chen", "alex@acme.dev"], ["one", "two"]);
    teammatePushes(remote, base, ["Priya Patel", "priya@acme.dev"], ["three"]);
    // Yours, pushed from another machine: not news.
    teammatePushes(remote, base, ["Test", "TEST@example.com"], ["four"]);
    git(work, "fetch", "-q");

    expect(await readArrivals(work, before, "origin/main")).toEqual([
      { ref: "origin/main", yours: true, commits: 3, authors: ["Priya Patel", "Alex Chen"] },
    ]);
    // Nothing moved since: nothing to say.
    expect(await readArrivals(work, await remoteTips(work, ["origin/main"]), null)).toEqual([]);
  });
});

describe("parseArrivalLog", () => {
  it("counts commits and names each author once", () => {
    const out = "Alex Chen\talex@acme.dev\nPriya Patel\tpriya@acme.dev\nAlex Chen\talex@acme.dev\nMe\tme@x.dev\n";
    expect(parseArrivalLog(out, "Me@X.dev")).toEqual({ commits: 3, authors: ["Alex Chen", "Priya Patel"] });
    expect(parseArrivalLog("", null)).toEqual({ commits: 0, authors: [] });
  });
});

describe("whoText", () => {
  it.each([
    [[], "Someone"],
    [["Alex Chen"], "Alex Chen"],
    [["Alex Chen", "Priya Patel"], "Alex Chen and Priya Patel"],
    [["A", "B", "C"], "A, B and 1 other"],
    [["A", "B", "C", "D"], "A, B and 2 others"],
  ])("%j → %s", (authors, text) => {
    expect(whoText(authors)).toBe(text);
  });
});

describe("arrivalMessage", () => {
  const branch: Arrival = { ref: "origin/feat/login", yours: true, commits: 1, authors: ["Alex Chen"] };
  const main: Arrival = { ref: "origin/main", yours: false, commits: 3, authors: ["Priya Patel", "Sam Lee"] };

  it("says who pushed what, your branch first", () => {
    expect(arrivalMessage([branch])).toBe("Alex Chen pushed 1 commit to origin/feat/login.");
    expect(arrivalMessage([main])).toBe("Priya Patel and Sam Lee pushed 3 commits to origin/main.");
    expect(arrivalMessage([main, branch])).toBe(
      "Alex Chen pushed 1 commit to origin/feat/login, and there are 3 commits on origin/main.",
    );
    expect(arrivalMessage([branch, { ...main, commits: 1 }])).toBe(
      "Alex Chen pushed 1 commit to origin/feat/login, and there is 1 commit on origin/main.",
    );
  });

  it("has nothing to say when nothing arrived", () => {
    expect(arrivalMessage([])).toBeNull();
  });
});

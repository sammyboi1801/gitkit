import type { BranchGraph, Ref } from "../../src/shared/types";

// Colour 0 is the main branch: the user can pick it (gitkit.mainBranchColor), the rest follow the theme.
const LANE_COLORS = [
  "var(--gk-main-color, var(--vscode-charts-blue))",
  "var(--vscode-charts-purple)",
  "var(--vscode-charts-green)",
  "var(--vscode-charts-orange)",
  "var(--vscode-charts-red)",
  "var(--vscode-charts-yellow)",
];

export const laneColor = (color: number): string => LANE_COLORS[color % LANE_COLORS.length];

/** The colour of the lane a ref belongs to, so a branch's chip matches its line. */
export function refColor(graph: BranchGraph, ref: Ref): string | undefined {
  if (ref.kind === "tag") return undefined;
  const name = ref.kind === "remote" ? ref.name.slice(ref.name.indexOf("/") + 1) : ref.name;
  const lane = graph.lanes.find((l) => l.name === name);
  return lane ? laneColor(lane.color) : undefined;
}

/** Newest commit index of each lane: where its name label goes. */
export function laneTips(graph: BranchGraph): Map<number, number> {
  const tips = new Map<number, number>();
  graph.placement.forEach((p, i) => {
    if (!tips.has(p.lane)) tips.set(p.lane, i);
  });
  return tips;
}

/** Oldest commit index of each lane: where the horizontal map writes the lane's name. */
export function laneStarts(graph: BranchGraph): Map<number, number> {
  const starts = new Map<number, number>();
  graph.placement.forEach((p, i) => starts.set(p.lane, i));
  return starts;
}

/** Applies the main-branch colour setting: a palette name or any CSS colour. */
export function applyMainColor(value: string): void {
  const named: Record<string, string> = {
    blue: "var(--vscode-charts-blue)",
    green: "var(--vscode-charts-green)",
    purple: "var(--vscode-charts-purple)",
    orange: "var(--vscode-charts-orange)",
    red: "var(--vscode-charts-red)",
    yellow: "var(--vscode-charts-yellow)",
  };
  const color = named[value.toLowerCase()] ?? (CSS.supports("color", value) ? value : named.blue);
  document.documentElement.style.setProperty("--gk-main-color", color);
}

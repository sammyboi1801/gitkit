<script lang="ts">
  import { stages } from "../../src/workflow/model";

  // Jobs drawn left to right by stage: everything in a column runs in parallel,
  // arrows show what waits for what.
  let {
    jobs,
    problemJobs = new Set<string>(),
  }: { jobs: { id: string; name: string; needs: string[] }[]; problemJobs?: Set<string> } = $props();

  const BOX_W = 150;
  const BOX_H = 34;
  const GAP_X = 56;
  const GAP_Y = 14;
  const PAD = 8;

  const columns = $derived(stages(jobs));
  const position = $derived.by(() => {
    const map = new Map<string, { x: number; y: number }>();
    columns.forEach((column, c) =>
      column.forEach((id, r) => map.set(id, { x: PAD + c * (BOX_W + GAP_X), y: PAD + r * (BOX_H + GAP_Y) })),
    );
    return map;
  });
  const width = $derived(PAD * 2 + Math.max(columns.length, 1) * (BOX_W + GAP_X) - GAP_X);
  const height = $derived(PAD * 2 + Math.max(1, ...columns.map((c) => c.length)) * (BOX_H + GAP_Y) - GAP_Y);

  function arrow(from: string, to: string): string {
    const a = position.get(from);
    const b = position.get(to);
    if (!a || !b) return "";
    const [x1, y1, x2, y2] = [a.x + BOX_W, a.y + BOX_H / 2, b.x, b.y + BOX_H / 2];
    const mid = (x1 + x2) / 2;
    return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2 - 6} ${y2}`;
  }
</script>

{#if jobs.length}
  <svg class="flow" {width} {height} role="img" aria-label="Job order">
    <defs>
      <marker id="arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0L8 4L0 8z" class="arrowhead" />
      </marker>
    </defs>
    {#each jobs as job (job.id)}
      {#each job.needs as need (need)}
        <path d={arrow(need, job.id)} class="flow-edge" marker-end="url(#arrowhead)" />
      {/each}
    {/each}
    {#each jobs as job (job.id)}
      {@const p = position.get(job.id)}
      {#if p}
        <g class="flow-job" class:problem={problemJobs.has(job.id)} transform="translate({p.x}, {p.y})">
          <rect width={BOX_W} height={BOX_H} rx="6" />
          <text x="10" y="21">{job.name.length > 18 ? job.name.slice(0, 17) + "…" : job.name}</text>
        </g>
      {/if}
    {/each}
  </svg>
{/if}

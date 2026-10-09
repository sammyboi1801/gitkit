<script lang="ts">
  import { describeCondition } from "../../src/workflow/conditions";

  // A job's or step's `if:` as a choice of common conditions, with the expression one click away
  // for anything else. The plain-words reading underneath says what it does either way.

  let {
    value,
    onchange,
    branch = "main",
    kind,
  }: { value: string; onchange: (value: string) => void; branch?: string; kind: "job" | "step" } = $props();

  const CHOICES = $derived(
    kind === "job"
      ? [
          { label: "Whenever the workflow runs", condition: "" },
          { label: `Only on ${branch}`, condition: `github.ref == 'refs/heads/${branch}'` },
          {
            label: `Only on pushes to ${branch}`,
            condition: `github.event_name == 'push' && github.ref == 'refs/heads/${branch}'`,
          },
          { label: "Only for version tags", condition: "startsWith(github.ref, 'refs/tags/v')" },
          { label: "Only when a pull request is merged", condition: "github.event.pull_request.merged == true" },
          { label: "Not on pull requests", condition: "github.event_name != 'pull_request'" },
          { label: "Even if a job before it failed", condition: "always()" },
          { label: "Only if a job before it failed", condition: "failure()" },
        ]
      : [
          { label: "When the steps before it passed", condition: "" },
          { label: "Even if a step before it failed", condition: "always()" },
          { label: "Only if a step before it failed", condition: "failure()" },
          { label: "Unless the run was cancelled", condition: "!cancelled()" },
          { label: `Only on ${branch}`, condition: `github.ref == 'refs/heads/${branch}'` },
          { label: "Only on pull requests", condition: "github.event_name == 'pull_request'" },
        ],
  );
  const CUSTOM = "custom";

  /** The person picked "Something else…", so the expression field shows even for a known condition. */
  let custom = $state(false);
  const current = $derived(value.trim());
  const choice = $derived(custom ? CUSTOM : (CHOICES.find((c) => c.condition === current)?.condition ?? CUSTOM));
  const words = $derived(describeCondition(current));

  function pick(next: string) {
    custom = next === CUSTOM;
    if (!custom) onchange(next);
  }
</script>

<div class="field condition-field">
  <span class="field-label">When it runs</span>
  <select
    aria-label={kind === "job" ? "When this job runs" : "When this step runs"}
    value={choice}
    onchange={(e) => pick(e.currentTarget.value)}
  >
    {#each CHOICES as c (c.condition)}<option value={c.condition}>{c.label}</option>{/each}
    <option value={CUSTOM}>Something else…</option>
  </select>
  {#if choice === CUSTOM}
    <input
      class="mono"
      aria-label="Condition"
      spellcheck="false"
      placeholder="needs.build.outputs.changed == 'true'"
      {value}
      oninput={(e) => onchange(e.currentTarget.value.trim())}
    />
    <span class="field-hint"
      >{words ? `Reads as: ${words}.` : "A GitHub expression, like the ones above."} Contexts: github, needs, matrix, inputs,
      vars, steps.</span
    >
  {:else if current}
    <span class="field-hint mono">if: {current}</span>
  {/if}
</div>

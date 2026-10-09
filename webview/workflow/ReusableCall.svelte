<script lang="ts">
  import type { Job } from "../../src/workflow/model";
  import { setPath } from "../../src/workflow/options";
  import KeyValues from "./KeyValues.svelte";

  // A job that runs another workflow (a reusable one, with on: workflow_call) instead of its own
  // steps: which workflow, the inputs it's given, and the secrets passed on.

  let { job, workflowFiles = [] }: { job: Job; workflowFiles?: string[] } = $props();

  const set = (path: string[], value: unknown) => {
    // An empty workflow still marks the job as a call, so the field stays while it's typed.
    job.extra = setPath(job.extra ? { ...job.extra } : undefined, path, value) ?? {};
    if (path[0] === "uses" && job.extra.uses === undefined) job.extra.uses = "";
  };
  const uses = $derived(typeof job.extra?.uses === "string" ? job.extra.uses : "");
  const inherit = $derived(job.extra?.secrets === "inherit");
  const local = $derived(workflowFiles.map((f) => `./.github/workflows/${f}`));
</script>

<label class="field">
  <span class="field-label">Workflow it runs</span>
  <input
    class="mono"
    aria-label="Workflow it runs"
    list="reusable-workflows"
    placeholder="./.github/workflows/deploy.yml or owner/repo/.github/workflows/build.yml@v1"
    value={uses}
    oninput={(e) => set(["uses"], e.currentTarget.value.trim())}
  />
  <datalist id="reusable-workflows">
    {#each local as file (file)}<option value={file}></option>{/each}
  </datalist>
  <span class="field-hint"
    >One in this repo starts with ./, one elsewhere is owner/repo/path@ref. It must run on workflow_call.</span
  >
</label>

<KeyValues
  label="Inputs it's given"
  value={job.extra?.with as Record<string, unknown> | undefined}
  onchange={(v) => set(["with"], v)}
  hint="The inputs the workflow declares under workflow_call."
/>

<div class="field" role="radiogroup" aria-label="Secrets">
  <span class="field-label">Secrets</span>
  <label class="toggle-row">
    <input type="radio" name="secrets-{job.id}" checked={inherit} onchange={() => set(["secrets"], "inherit")} />
    <span><span class="toggle-title">Pass all of this workflow's secrets</span></span>
  </label>
  <label class="toggle-row">
    <input type="radio" name="secrets-{job.id}" checked={!inherit} onchange={() => set(["secrets"], undefined)} />
    <span><span class="toggle-title">Only the ones listed</span></span>
  </label>
  {#if !inherit}
    <KeyValues
      label="Secrets passed"
      value={job.extra?.secrets as Record<string, unknown> | undefined}
      onchange={(v) => set(["secrets"], v)}
      hint={"Each as ${{ secrets.NAME }}."}
    />
  {/if}
</div>

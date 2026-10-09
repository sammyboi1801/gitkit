<script lang="ts">
  import { applyOn } from "../../src/workflow/import";
  import type { WorkflowModel } from "../../src/workflow/model";
  import { getPath, setPath } from "../../src/workflow/options";
  import { triggersYaml } from "../../src/workflow/yaml";
  import KeyValues from "./KeyValues.svelte";
  import YamlBox from "./YamlBox.svelte";

  // Settings for the whole workflow, plus the two escape hatches: triggers as YAML (any event GitHub
  // supports) and the rest of the workflow's top-level keys as YAML.

  let { model = $bindable(), triggersOpen = $bindable(false) }: { model: WorkflowModel; triggersOpen?: boolean } =
    $props();

  let revision = $state(0);
  let restOpen = $state(false);

  const set = (path: string[], value: unknown) => {
    model.extra = setPath(model.extra ? { ...model.extra } : undefined, path, value);
  };
  const text = (path: string[]) => {
    const v = getPath(model.extra, path);
    return typeof v === "string" ? v : "";
  };
</script>

<section class="card" aria-labelledby="settings-heading">
  <div class="card-head">
    <h3 id="settings-heading">More settings</h3>
    <span class="card-sub">For the whole workflow.</span>
  </div>
  {#key revision}
    <div class="options-grid wide">
      <KeyValues
        label="Environment variables"
        value={model.extra?.env as Record<string, unknown> | undefined}
        onchange={(v) => set(["env"], v)}
        hint={"Available to every job. Secrets: ${{ secrets.NAME }}."}
      />
      <label class="field">
        <span class="field-label">Name of each run<span class="optional"> optional</span></span>
        <input
          class="mono"
          placeholder={"Deploy by @${{ github.actor }}"}
          value={text(["run-name"])}
          oninput={(e) => set(["run-name"], e.currentTarget.value.trim())}
        />
        <span class="field-hint">Shown in the list of runs on GitHub instead of the commit message.</span>
      </label>
      <label class="field">
        <span class="field-label">Run commands in folder<span class="optional"> optional</span></span>
        <input
          class="mono"
          placeholder="the repository root"
          value={text(["defaults", "run", "working-directory"])}
          oninput={(e) => set(["defaults", "run", "working-directory"], e.currentTarget.value.trim())}
        />
      </label>
    </div>
  {/key}

  <details class="advanced" bind:open={triggersOpen}>
    <summary>All triggers as YAML</summary>
    {#if triggersOpen}
      <YamlBox
        label="When it runs"
        value={triggersYaml(model)}
        onapply={(v) => applyOn(model, v ?? {})}
        hint="The whole on: block. Every trigger above can also be set up with its own options."
      />
    {/if}
  </details>
  <details class="advanced" bind:open={restOpen}>
    <summary>Workflow settings as YAML</summary>
    {#if restOpen}
      <YamlBox
        label="Top-level keys other than name, on and jobs"
        value={model.extra}
        onapply={(v) => {
          model.extra = v;
          revision++;
        }}
        hint="Written into the workflow as is: permissions, concurrency, defaults and so on."
      />
    {/if}
  </details>
</section>

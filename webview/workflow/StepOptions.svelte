<script lang="ts">
  import { isEmpty } from "../../src/workflow/options";
  import type { Step } from "../../src/workflow/model";
  import KeyValues from "./KeyValues.svelte";

  // A step's less common settings. Clearing a field removes the key from the YAML.

  let { step }: { step: Step } = $props();

  const SHELLS = ["bash", "pwsh", "python", "sh", "cmd", "powershell"];

  function set(key: string, value: unknown) {
    if (isEmpty(value)) delete step[key];
    else step[key] = value;
  }
  const text = (key: string) =>
    typeof step[key] === "string" || typeof step[key] === "number" ? String(step[key]) : "";
</script>

<details class="advanced step-options">
  <summary>More options</summary>
  <div class="options-grid">
    <KeyValues
      label="Environment variables"
      value={step.env as Record<string, unknown> | undefined}
      onchange={(v) => set("env", v)}
      hint={"Secrets go here too, as ${{ secrets.NAME }}."}
    />
    <label class="field">
      <span class="field-label">Run in folder<span class="optional"> optional</span></span>
      <input
        class="mono"
        placeholder="the repository root"
        value={text("working-directory")}
        oninput={(e) => set("working-directory", e.currentTarget.value.trim())}
      />
    </label>
    {#if step.uses === undefined}
      <label class="field">
        <span class="field-label">Shell</span>
        <select value={text("shell")} onchange={(e) => set("shell", e.currentTarget.value)}>
          <option value="">Default (bash; PowerShell on Windows)</option>
          {#each SHELLS as shell (shell)}<option value={shell}>{shell}</option>{/each}
        </select>
      </label>
    {/if}
    <label class="field">
      <span class="field-label">Stop after (minutes)<span class="optional"> optional</span></span>
      <input
        class="short"
        type="number"
        min="1"
        placeholder="no limit"
        value={text("timeout-minutes")}
        oninput={(e) => set("timeout-minutes", e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
      />
    </label>
    <label class="toggle-row">
      <input
        type="checkbox"
        checked={step["continue-on-error"] === true}
        onchange={(e) => set("continue-on-error", e.currentTarget.checked || undefined)}
      />
      <span><span class="toggle-title">Keep going if this step fails</span></span>
    </label>
    <label class="field">
      <span class="field-label">Id<span class="optional"> optional</span></span>
      <input
        class="mono short"
        placeholder="build"
        value={text("id")}
        oninput={(e) => set("id", e.currentTarget.value.trim())}
      />
      <span class="field-hint">{"Lets later steps read its outputs: ${{ steps.ID.outputs.NAME }}."}</span>
    </label>
  </div>
</details>

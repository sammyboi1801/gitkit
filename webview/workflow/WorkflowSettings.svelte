<script lang="ts">
  import { applyOn } from "../../src/workflow/import";
  import type { WorkflowModel } from "../../src/workflow/model";
  import { PERMISSION_SCOPES, getPath, levelsFor, setPath } from "../../src/workflow/options";
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
  const SHELLS = ["bash", "pwsh", "python", "sh", "cmd", "powershell"];

  // The table shows what jobs get: set here, or what "Read-only access by default" gives them.
  const custom = $derived(model.extra?.permissions as Record<string, string> | undefined);
  const permissions = $derived(custom ?? (model.readOnlyPermissions ? { contents: "read" } : undefined));
  function setPermission(scope: string, level: string) {
    const next = { ...(permissions ?? {}) };
    if (level) next[scope] = level;
    else delete next[scope];
    set(["permissions"], Object.keys(next).length ? next : undefined);
  }
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
      <label class="field">
        <span class="field-label">Shell for commands</span>
        <select
          value={text(["defaults", "run", "shell"])}
          onchange={(e) => set(["defaults", "run", "shell"], e.currentTarget.value)}
        >
          <option value="">Default (bash; PowerShell on Windows)</option>
          {#each SHELLS as shell (shell)}<option value={shell}>{shell}</option>{/each}
        </select>
      </label>
      <div class="field" role="group" aria-label="Workflow concurrency">
        <span class="field-label">One run at a time<span class="optional"> optional</span></span>
        <input
          class="mono"
          aria-label="Workflow concurrency group"
          placeholder={"${{ github.workflow }}-${{ github.ref }}"}
          value={text(["concurrency", "group"]) || text(["concurrency"])}
          oninput={(e) => {
            const group = e.currentTarget.value.trim();
            set(
              ["concurrency"],
              group
                ? {
                    group,
                    ...(getPath(model.extra, ["concurrency", "cancel-in-progress"])
                      ? { "cancel-in-progress": true }
                      : {}),
                  }
                : undefined,
            );
          }}
        />
        {#if getPath(model.extra, ["concurrency"])}
          <label class="toggle-row">
            <input
              type="checkbox"
              checked={getPath(model.extra, ["concurrency", "cancel-in-progress"]) === true}
              onchange={(e) =>
                set(["concurrency"], {
                  group: text(["concurrency", "group"]) || text(["concurrency"]),
                  ...(e.currentTarget.checked ? { "cancel-in-progress": true } : {}),
                })}
            />
            <span><span class="toggle-title">Cancel the run already going</span></span>
          </label>
        {/if}
        <span class="field-hint">Runs in the same group wait for each other. Overrides "Cancel outdated runs".</span>
      </div>
    </div>

    <div class="field" role="group" aria-label="Workflow permissions">
      <span class="field-label">Permissions for every job</span>
      <div class="permissions">
        {#each PERMISSION_SCOPES as { scope, what } (scope)}
          <label class="permission" title={what}>
            <span class="mono">{scope}</span>
            <select
              aria-label="{scope} permission for every job"
              value={permissions?.[scope] ?? ""}
              onchange={(e) => setPermission(scope, e.currentTarget.value)}
            >
              <option value="">{permissions ? "no access" : "GitHub's default"}</option>
              {#each levelsFor(scope).filter((l) => l !== "none") as level (level)}<option value={level}>{level}</option
                >{/each}
            </select>
          </label>
        {/each}
      </div>
      <span class="field-hint"
        >{permissions
          ? "Every job gets exactly this, unless it sets its own. Anything not listed gets no access."
          : 'Following "Read-only access by default" above. Pick a level to set them yourself.'}</span
      >
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

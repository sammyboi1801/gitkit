<script lang="ts">
  import { template, templateKeys, type Job } from "../../src/workflow/model";
  import {
    PERMISSION_SCOPES,
    getPath,
    levelsFor,
    matrixRows,
    serviceRows,
    setPath,
    withMatrix,
    withServices,
    type ServiceRow,
  } from "../../src/workflow/options";
  import KeyValues from "./KeyValues.svelte";
  import YamlBox from "./YamlBox.svelte";

  // A job's less common settings, as fields: everything lands in job.extra, which the generator
  // writes as is. "Job settings as YAML" covers anything without a field.

  let { job, onrename }: { job: Job; onrename: (id: string) => void } = $props();

  /** Bumped when the YAML box changes things, so the fields re-read them. */
  let revision = $state(0);
  let yamlOpen = $state(false);

  const t = $derived(template(job.template));
  const extra = (path: string[]) => getPath(job.extra, path);
  const set = (path: string[], value: unknown) => {
    job.extra = setPath(job.extra ? { ...job.extra } : undefined, path, value);
  };
  const text = (path: string[]) => {
    const v = extra(path);
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  };

  // A template with versions already has its own matrix; another one would replace it.
  const ownMatrix = $derived(!t.matrixKey);
  // svelte-ignore state_referenced_locally
  let matrix = $state(matrixRows(job.extra?.strategy));
  // svelte-ignore state_referenced_locally
  let services: ServiceRow[] = $state(serviceRows(job.extra?.services));

  const permissions = $derived(
    (job.extra?.permissions as Record<string, string> | undefined) ??
      (templateKeys(job).permissions as Record<string, string> | undefined),
  );
  function setPermission(scope: string, level: string) {
    const next = { ...(permissions ?? {}) };
    if (level) next[scope] = level;
    else delete next[scope];
    set(["permissions"], Object.keys(next).length ? next : undefined);
  }

  const environment = $derived.by(() => {
    const env = extra(["environment"]);
    return typeof env === "string"
      ? env
      : typeof getPath(job.extra, ["environment", "name"]) === "string"
        ? String(getPath(job.extra, ["environment", "name"]))
        : "";
  });
</script>

<details class="advanced job-options">
  <summary>More options</summary>
  <div class="options-grid">
    {#key revision}
      <KeyValues
        label="Environment variables"
        value={job.extra?.env as Record<string, unknown> | undefined}
        onchange={(v) => set(["env"], v)}
        hint={"For every step in this job. Secrets: ${{ secrets.NAME }}."}
      />

      {#if ownMatrix}
        <div class="field" role="group" aria-label="Run for each">
          <span class="field-label">Run for each<span class="optional"> optional</span></span>
          {#each matrix as row, i (i)}
            <div class="input-row">
              <input
                class="mono"
                aria-label="Matrix variable"
                placeholder="os"
                bind:value={row.name}
                oninput={() => set(["strategy"], withMatrix(job.extra?.strategy, matrix))}
              />
              <input
                class="mono"
                aria-label="Values of {row.name || 'the new variable'}"
                placeholder="ubuntu-latest, windows-latest"
                bind:value={row.values}
                oninput={() => set(["strategy"], withMatrix(job.extra?.strategy, matrix))}
              />
              <button
                class="icon-button"
                aria-label="Remove matrix variable {row.name}"
                onclick={() => {
                  matrix.splice(i, 1);
                  set(["strategy"], withMatrix(job.extra?.strategy, matrix));
                }}><span class="codicon codicon-close"></span></button
              >
            </div>
          {/each}
          <button class="link" onclick={() => matrix.push({ name: "", values: "" })}
            ><span class="codicon codicon-add"></span>Add a variable</button
          >
          <span class="field-hint"
            >{"The job runs once per combination. Use a value as ${{ matrix.NAME }}, e.g. runs-on: ${{ matrix.os }}."}</span
          >
          {#if matrix.some((r) => r.name.trim())}
            <label class="toggle-row">
              <input
                type="checkbox"
                checked={extra(["strategy", "fail-fast"]) === false}
                onchange={(e) => set(["strategy", "fail-fast"], e.currentTarget.checked ? false : undefined)}
              />
              <span><span class="toggle-title">Finish the other combinations when one fails</span></span>
            </label>
          {/if}
        </div>
      {/if}

      <div class="field" role="group" aria-label="Service containers">
        <span class="field-label">Service containers<span class="optional"> optional</span></span>
        {#each services as row, i (i)}
          <div class="service-row">
            <input
              class="mono"
              aria-label="Service name"
              placeholder="postgres"
              bind:value={row.name}
              oninput={() => set(["services"], withServices(job.extra?.services, services))}
            />
            <input
              class="mono"
              aria-label="Image of {row.name || 'the new service'}"
              placeholder="postgres:17"
              bind:value={row.image}
              oninput={() => set(["services"], withServices(job.extra?.services, services))}
            />
            <input
              class="mono"
              aria-label="Ports of {row.name || 'the new service'}"
              placeholder="5432:5432"
              bind:value={row.ports}
              oninput={() => set(["services"], withServices(job.extra?.services, services))}
            />
            <button
              class="icon-button"
              aria-label="Remove service {row.name}"
              onclick={() => {
                services.splice(i, 1);
                set(["services"], withServices(job.extra?.services, services));
              }}><span class="codicon codicon-close"></span></button
            >
          </div>
        {/each}
        <button class="link" onclick={() => services.push({ name: "", image: "", ports: "" })}
          ><span class="codicon codicon-add"></span>Add a database or other service</button
        >
        <span class="field-hint"
          >Containers that run beside the job, like a database for tests: reach them on localhost.</span
        >
      </div>

      <label class="field">
        <span class="field-label">Stop after (minutes)<span class="optional"> optional</span></span>
        <input
          class="short"
          type="number"
          min="1"
          placeholder="360"
          value={text(["timeout-minutes"])}
          oninput={(e) => set(["timeout-minutes"], e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
        />
      </label>

      <label class="toggle-row">
        <input
          type="checkbox"
          checked={extra(["continue-on-error"]) === true}
          onchange={(e) => set(["continue-on-error"], e.currentTarget.checked || undefined)}
        />
        <span><span class="toggle-title">Don't fail the workflow if this job fails</span></span>
      </label>

      <label class="field">
        <span class="field-label">Deployment environment<span class="optional"> optional</span></span>
        <input
          class="mono short"
          placeholder="production"
          value={environment}
          oninput={(e) => set(["environment"], e.currentTarget.value.trim())}
        />
        <span class="field-hint"
          >Uses that environment's secrets and approval rules, set up in the repo's settings.</span
        >
      </label>

      <label class="field">
        <span class="field-label">Run inside a container<span class="optional"> optional</span></span>
        <input
          class="mono"
          placeholder="node:24"
          value={text(["container"])}
          oninput={(e) => set(["container"], e.currentTarget.value.trim())}
        />
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

      <div class="field" role="group" aria-label="Permissions">
        <span class="field-label">Permissions for this job</span>
        <div class="permissions">
          {#each PERMISSION_SCOPES as { scope, what } (scope)}
            <label class="permission" title={what}>
              <span class="mono">{scope}</span>
              <select
                aria-label="{scope} permission"
                value={permissions?.[scope] ?? ""}
                onchange={(e) => setPermission(scope, e.currentTarget.value)}
              >
                <option value="">{permissions ? "no access" : "workflow default"}</option>
                {#each levelsFor(scope).filter((l) => l !== "none") as level (level)}<option value={level}
                    >{level}</option
                  >{/each}
              </select>
            </label>
          {/each}
        </div>
        <span class="field-hint"
          >{permissions
            ? "Set here, these replace the workflow's defaults for this job: anything not listed gets no access."
            : "Uses the workflow's defaults. Pick a level to give this job its own."}</span
        >
      </div>
    {/key}

    <label class="field">
      <span class="field-label">Id in the YAML</span>
      <input class="mono short" value={job.id} onchange={(e) => onrename(e.currentTarget.value.trim())} />
      <span class="field-hint">How other jobs refer to it, e.g. in needs.</span>
    </label>

    <details class="advanced" bind:open={yamlOpen}>
      <summary>Job settings as YAML</summary>
      {#if yamlOpen}
        <YamlBox
          label="Everything set above, plus anything else GitHub Actions supports"
          value={job.extra}
          onapply={(v) => {
            job.extra = v;
            matrix = matrixRows(v?.strategy);
            services = serviceRows(v?.services);
            revision++;
          }}
          hint="Written into this job as is: concurrency, outputs, strategy.include and so on."
        />
      {/if}
    </details>
  </div>
</details>

<script lang="ts">
  import { eventSpec, filterOf, typeWords, typesOf, type Filter } from "../../src/workflow/events";
  import {
    outputRows,
    scheduleRows,
    secretRows,
    setFilter,
    setKey,
    setTypes,
    splitList,
    withOutputs,
    withSchedules,
    withSecrets,
    type OutputRow,
    type ScheduleRow,
    type SecretRow,
  } from "../../src/workflow/triggers";
  import InputsEditor from "./InputsEditor.svelte";
  import ScheduleEditor from "./ScheduleEditor.svelte";
  import YamlBox from "./YamlBox.svelte";

  // One trigger's options, built from what GitHub supports for that event: filters, activity types,
  // schedules, inputs. Anything else it takes can be written in its own YAML box.

  let {
    event,
    config,
    onchange,
    ondone,
    workflowNames = [],
  }: {
    event: string;
    config: unknown;
    onchange: (config: unknown) => void;
    ondone: () => void;
    workflowNames?: string[];
  } = $props();

  const spec = $derived(eventSpec(event));
  const FILTER_LABELS: Record<Filter, { label: string; placeholder: string; hint: string }> = {
    branches: { label: "Branches", placeholder: "main, release/*", hint: "Patterns work: release/* or **." },
    tags: { label: "Tags", placeholder: "v*", hint: "v* matches v1.0, v2.3.1 and so on." },
    paths: {
      label: "Only when these files change",
      placeholder: "src/**, package.json",
      hint: "Glob patterns, like docs/** or *.md.",
    },
  };

  // --- types ---
  const selectedTypes = $derived(typesOf(config) ?? spec?.defaultTypes ?? spec?.types ?? []);
  function toggleType(type: string) {
    const next = selectedTypes.includes(type) ? selectedTypes.filter((t) => t !== type) : [...selectedTypes, type];
    onchange(setTypes(config, next.length ? next : null, spec?.defaultTypes ?? spec?.types));
  }

  // --- schedule ---
  // svelte-ignore state_referenced_locally
  let schedules: ScheduleRow[] = $state(scheduleRows(config));
  const commitSchedules = () => onchange(withSchedules(schedules));

  // --- workflow_call ---
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  // svelte-ignore state_referenced_locally
  let secrets: SecretRow[] = $state(secretRows(obj(config).secrets));
  // svelte-ignore state_referenced_locally
  let outputs: OutputRow[] = $state(outputRows(obj(config).outputs));

  /** Bumped when the YAML box changes the config, so the fields above read it again. */
  let revision = $state(0);
  let yamlOpen = $state(false);
</script>

<div class="trigger-editor" role="group" aria-label="{spec?.label ?? event} options">
  {#if spec}<p class="field-hint trigger-about">{spec.description}</p>{/if}

  {#key revision}
    {#if spec?.special === "schedule"}
      {#each schedules as row, i (i)}
        <div class="schedule-item">
          <ScheduleEditor
            {row}
            label="Schedule {i + 1}"
            onchange={(next) => {
              schedules[i] = next;
              commitSchedules();
            }}
          />
          {#if schedules.length > 1}
            <button
              class="icon-button"
              aria-label="Remove schedule {i + 1}"
              onclick={() => {
                schedules.splice(i, 1);
                commitSchedules();
              }}><span class="codicon codicon-close"></span></button
            >
          {/if}
        </div>
      {/each}
      <button
        class="link"
        onclick={() => {
          schedules.push({ cron: "0 18 * * 5" });
          commitSchedules();
        }}><span class="codicon codicon-add"></span>Add another schedule</button
      >
      <span class="field-hint">GitHub may start scheduled runs a few minutes late when it's busy.</span>
    {/if}

    {#if spec?.special === "dispatch"}
      <InputsEditor
        inputs={obj(config).inputs}
        kinds={["string", "choice", "boolean", "number", "environment"]}
        what="person who presses Run"
        onchange={(inputs) => onchange(setKey(config, "inputs", inputs))}
      />
    {/if}

    {#if spec?.special === "call"}
      <InputsEditor
        inputs={obj(config).inputs}
        kinds={["string", "number", "boolean"]}
        what="calling workflow"
        onchange={(inputs) => onchange(setKey(config, "inputs", inputs))}
      />
      <div class="field" role="group" aria-label="Secrets">
        <span class="field-label">Secrets it needs<span class="optional"> optional</span></span>
        {#each secrets as row, i (i)}
          <div class="input-row">
            <input
              class="mono"
              aria-label="Secret name"
              placeholder="NPM_TOKEN"
              bind:value={row.name}
              oninput={() => onchange(setKey(config, "secrets", withSecrets(secrets)))}
            />
            <label class="inline-toggle"
              ><input
                type="checkbox"
                bind:checked={row.required}
                onchange={() => onchange(setKey(config, "secrets", withSecrets(secrets)))}
              />Required</label
            >
            <button
              class="icon-button"
              aria-label="Remove secret {row.name}"
              onclick={() => {
                secrets.splice(i, 1);
                onchange(setKey(config, "secrets", withSecrets(secrets)));
              }}><span class="codicon codicon-close"></span></button
            >
          </div>
        {/each}
        <button class="link" onclick={() => secrets.push({ name: "", description: "", required: false })}
          ><span class="codicon codicon-add"></span>Add a secret</button
        >
        <span class="field-hint"
          >{"The caller passes them, or all of its own with secrets: inherit. Read as ${{ secrets.NAME }}."}</span
        >
      </div>
      <div class="field" role="group" aria-label="Outputs">
        <span class="field-label">Outputs it returns<span class="optional"> optional</span></span>
        {#each outputs as row, i (i)}
          <div class="input-row">
            <input
              class="mono"
              aria-label="Output name"
              placeholder="version"
              bind:value={row.name}
              oninput={() => onchange(setKey(config, "outputs", withOutputs(outputs)))}
            />
            <input
              class="mono"
              aria-label="Value of {row.name || 'the output'}"
              placeholder={"${{ jobs.build.outputs.version }}"}
              bind:value={row.value}
              oninput={() => onchange(setKey(config, "outputs", withOutputs(outputs)))}
            />
            <button
              class="icon-button"
              aria-label="Remove output {row.name}"
              onclick={() => {
                outputs.splice(i, 1);
                onchange(setKey(config, "outputs", withOutputs(outputs)));
              }}><span class="codicon codicon-close"></span></button
            >
          </div>
        {/each}
        <button class="link" onclick={() => outputs.push({ name: "", value: "", description: "" })}
          ><span class="codicon codicon-add"></span>Add an output</button
        >
      </div>
    {/if}

    {#if spec?.special === "workflow_run"}
      <label class="field">
        <span class="field-label">After which workflows</span>
        <input
          class="mono"
          aria-label="After which workflows"
          list="workflow-names"
          placeholder="CI"
          value={(Array.isArray(obj(config).workflows) ? (obj(config).workflows as string[]) : []).join(", ")}
          oninput={(e) => onchange(setKey(config, "workflows", splitList(e.currentTarget.value)))}
        />
        <datalist id="workflow-names">
          {#each workflowNames as name (name)}<option value={name}></option>{/each}
        </datalist>
        <span class="field-hint">Their names, as shown on GitHub (the name: at the top of each file).</span>
      </label>
    {/if}

    {#if spec?.customTypes}
      <label class="field">
        <span class="field-label">Event types<span class="optional"> optional</span></span>
        <input
          class="mono"
          placeholder="deploy, nightly"
          value={(typesOf(config) ?? []).join(", ")}
          oninput={(e) => {
            const types = splitList(e.currentTarget.value);
            onchange(setTypes(config, types.length ? types : null));
          }}
        />
        <span class="field-hint">The event_type the API call sends. Leave empty for any.</span>
      </label>
    {/if}

    {#each spec?.filters ?? [] as filter (filter)}
      {@const current = filterOf(config, filter)}
      {@const text = FILTER_LABELS[filter]}
      <div class="field filter-field">
        <span class="field-label">{text.label}<span class="optional"> optional</span></span>
        <div class="input-row">
          <select
            aria-label="{text.label}: only or except"
            value={current?.mode ?? "only"}
            onchange={(e) =>
              onchange(setFilter(config, filter, e.currentTarget.value as "only" | "except", current?.values ?? []))}
          >
            <option value="only">Only these</option>
            <option value="except">All except</option>
          </select>
          <input
            class="mono"
            aria-label={text.label}
            placeholder={current ? "" : filter === "paths" ? "any file" : `any ${filter === "tags" ? "tag" : "branch"}`}
            value={(current?.values ?? []).join(", ")}
            oninput={(e) =>
              onchange(setFilter(config, filter, current?.mode ?? "only", splitList(e.currentTarget.value)))}
          />
        </div>
        <span class="field-hint">{text.hint}</span>
      </div>
    {/each}

    {#if spec?.types && spec.types.length > 1}
      <div class="field" role="group" aria-label="Activity types">
        <span class="field-label">When it's</span>
        <div class="type-chips">
          {#each spec.types as type (type)}
            <button
              class="type-chip"
              aria-pressed={selectedTypes.includes(type)}
              class:on={selectedTypes.includes(type)}
              onclick={() => toggleType(type)}>{typeWords(type)}</button
            >
          {/each}
        </div>
        {#if spec.defaultTypes && !typesOf(config)}
          <span class="field-hint">GitHub's default. Pick others to change it.</span>
        {/if}
      </div>
    {/if}

    {#if spec?.special !== "schedule"}
      <details class="advanced" bind:open={yamlOpen}>
        <summary>This trigger as YAML</summary>
        {#if yamlOpen}
          <YamlBox
            label="{event}:"
            value={config}
            onapply={(v) => {
              onchange(v ?? null);
              schedules = scheduleRows(v);
              secrets = secretRows(obj(v).secrets);
              outputs = outputRows(obj(v).outputs);
              revision++;
            }}
            hint="Anything GitHub supports for this event. The fields above follow what you write."
          />
        {/if}
      </details>
    {/if}
  {/key}
  <button class="done-link" onclick={ondone}>Done</button>
</div>

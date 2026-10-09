<script lang="ts">
  import { tick } from "svelte";
  import {
    RUNNERS,
    TEMPLATES,
    addPreset,
    jobLook,
    newJob,
    stages,
    template,
    toOwnSteps,
    type Job,
    type Problem,
    type Stack,
    type Step,
    type Template,
    type WorkflowModel,
  } from "../../src/workflow/model";
  import { describeCondition } from "../../src/workflow/conditions";
  import { describeEvent, eventSpec, normalizeOn } from "../../src/workflow/events";
  import { applyOn } from "../../src/workflow/import";
  import { setPath } from "../../src/workflow/options";
  import { addEvent, addVersionTags, removeEvent } from "../../src/workflow/triggers";
  import { mainBranch, warnings } from "../../src/workflow/warnings";
  import { triggersYaml } from "../../src/workflow/yaml";
  import ConditionField from "./ConditionField.svelte";
  import JobOptions from "./JobOptions.svelte";
  import StepOptions from "./StepOptions.svelte";
  import StepPicker from "./StepPicker.svelte";
  import TriggerEditor from "./TriggerEditor.svelte";
  import TriggerPicker from "./TriggerPicker.svelte";
  import WorkflowSettings from "./WorkflowSettings.svelte";

  let {
    model = $bindable(),
    problems,
    stacks,
    workflowNames = [],
  }: { model: WorkflowModel; problems: Problem[]; stacks: Stack[]; workflowNames?: string[] } = $props();

  const GROUPS: { id: Template["group"]; label: string }[] = [
    { id: "check", label: "Check the code" },
    { id: "build", label: "Build" },
    { id: "ship", label: "Ship it" },
    { id: "other", label: "Anything else" },
  ];

  /** The event whose options are open under the chips. */
  let editingEvent: string | null = $state(null);
  let addingTrigger = $state(false);
  /** Where a new job goes: the ids it should run after (empty: at the start). Null when closed. */
  let addingJobAfter: string[] | null = $state(null);
  let pickerSearch = $state("");
  let selected: Job | null = $state(null);
  let drawer: HTMLElement | undefined = $state();
  let picker: HTMLElement | undefined = $state();
  /** The step whose fields are showing in the job panel. */
  let openStep: number | null = $state(null);
  let addingStep = $state(false);
  /** Access the last added step needed, granted to its job: said once, under the steps. */
  let granted: string[] = $state([]);
  /** The "All triggers as YAML" box in More settings. */
  let triggersYamlOpen = $state(false);

  // Keys the step editor has fields for; anything else is listed as kept as written.
  const KNOWN_STEP_KEYS = [
    "name",
    "run",
    "uses",
    "with",
    "if",
    "id",
    "env",
    "working-directory",
    "shell",
    "timeout-minutes",
    "continue-on-error",
  ];

  // Triggers are edited as the `on:` block itself, one event at a time, so every event GitHub has
  // works the same way; applyOn keeps Studio's own record of them in step.
  const on = $derived(normalizeOn(triggersYaml(model)));
  const events = $derived(Object.keys(on));
  const updateOn = (next: Record<string, unknown>) => applyOn(model, next);
  function pickTrigger(choice: string) {
    if (choice === "version-tags") {
      updateOn(addVersionTags(on));
      editingEvent = "push";
    } else {
      updateOn(addEvent(on, choice, branch));
      editingEvent = choice;
    }
    addingTrigger = false;
  }
  function dropTrigger(event: string) {
    updateOn(removeEvent(on, event));
    if (editingEvent === event) editingEvent = null;
  }
  const hasTags = $derived(!!on.push && typeof on.push === "object" && ("tags" in on.push || "tags-ignore" in on.push));

  const columns = $derived(stages(model.jobs).map((ids) => ids.map((id) => model.jobs.find((j) => j.id === id)!)));
  const problemsFor = (job: Job) => problems.filter((p) => p.job === job.id);
  // Warnings don't block saving: the workflow is valid, it just probably doesn't do what was meant.
  const warns = $derived(warnings(model));
  const warningsFor = (job: Job) => warns.filter((w) => w.job === job.id);
  const branch = $derived(mainBranch(model));
  const setCondition = (job: Job, condition: string) => {
    job.extra = setPath(job.extra ? { ...job.extra } : undefined, ["if"], condition);
  };
  const general = $derived(problems.filter((p) => !p.job));

  // The project's own stack first, then everything else; search narrows by name or description.
  function templatesIn(group: Template["group"]): Template[] {
    const q = pickerSearch.trim().toLowerCase();
    const fit = (t: Template) => (t.stack === null || stacks.includes(t.stack) ? 0 : 1);
    return TEMPLATES.filter((t) => t.group === group)
      .filter((t) => !q || `${t.label} ${t.description}`.toLowerCase().includes(q))
      .sort((a, b) => fit(a) - fit(b));
  }

  async function openPicker(after: string[]) {
    addingJobAfter = after;
    pickerSearch = "";
    await tick();
    picker?.querySelector<HTMLInputElement>("input")?.focus();
  }

  async function addJob(t: Template) {
    const job = newJob(t.id, model.jobs);
    job.needs = [...(addingJobAfter ?? [])];
    model.jobs.push(job);
    addingJobAfter = null;
    await edit(model.jobs[model.jobs.length - 1]);
  }

  async function edit(job: Job | null) {
    if (job !== selected) {
      openStep = null;
      addingStep = false;
      granted = [];
    }
    selected = job;
    await tick();
    drawer?.querySelector<HTMLInputElement>("input")?.focus();
  }

  function removeJob(job: Job) {
    model.jobs = model.jobs.filter((j) => j !== job);
    for (const j of model.jobs) j.needs = j.needs.filter((n) => n !== job.id);
    if (selected === job) selected = null;
  }

  function renameId(job: Job, id: string) {
    for (const j of model.jobs) j.needs = j.needs.map((n) => (n === job.id ? id : n));
    job.id = id;
  }

  function toggleVersion(job: Job, version: string) {
    job.versions = job.versions.includes(version)
      ? job.versions.filter((v) => v !== version)
      : [...job.versions, version];
  }

  function toggleNeed(job: Job, id: string) {
    job.needs = job.needs.includes(id) ? job.needs.filter((n) => n !== id) : [...job.needs, id];
  }

  /** Where the job runs, in words; runner groups and label lists from a file are shown as written. */
  function runnerLabel(job: Job): string {
    const custom = job.extra?.["runs-on"];
    if (custom !== undefined) return Array.isArray(custom) ? custom.join(", ") : JSON.stringify(custom);
    return RUNNERS.find((r) => r.value === job.runsOn)?.label ?? job.runsOn;
  }

  function meta(job: Job): string {
    if (typeof job.extra?.uses === "string") return `calls ${job.extra.uses}`;
    if (job.template === "steps") {
      const n = job.steps?.length ?? 0;
      return `${runnerLabel(job)} · ${n} step${n === 1 ? "" : "s"}`;
    }
    const t = template(job.template);
    const versions = t.matrixKey && job.versions.length ? ` · ${job.versions.join(", ")}` : "";
    const command = job.inputs.command || job.inputs.build || "";
    return `${runnerLabel(job)}${versions}${command ? ` · ${command}` : ""}`;
  }

  // --- Steps ---

  const stepLabel = (s: Step) =>
    s.name || s.uses || (typeof s.run === "string" && s.run.split("\n")[0]) || "Empty step";
  const isAction = (s: Step) => s.uses !== undefined;
  /** Keys the step editor doesn't show; they're kept as written. */
  const otherKeys = (s: Step) => Object.keys(s).filter((k) => !KNOWN_STEP_KEYS.includes(k));
  // Job keys that have a field under More options; any others are listed as kept as written.
  const JOB_FIELDS = [
    "runs-on",
    "uses",
    "env",
    "if",
    "strategy",
    "services",
    "timeout-minutes",
    "continue-on-error",
    "environment",
    "container",
    "defaults",
    "permissions",
  ];
  const keptKeys = (job: Job) => Object.keys(job.extra ?? {}).filter((k) => !JOB_FIELDS.includes(k));

  /** Turns a ready-made job into its steps so each one can be edited. */
  async function customize(job: Job) {
    const i = model.jobs.indexOf(job);
    model.jobs[i] = toOwnSteps(job);
    openStep = null;
    await edit(model.jobs[i]);
  }

  function addStep(job: Job, preset: string) {
    const added = addPreset(job, preset, model.readOnlyPermissions);
    openStep = added.first;
    granted = added.granted;
    addingStep = false;
  }

  function moveStep(job: Job, i: number, by: number) {
    const steps = [...(job.steps ?? [])];
    [steps[i], steps[i + by]] = [steps[i + by], steps[i]];
    job.steps = steps;
    if (openStep === i) openStep = i + by;
    else if (openStep === i + by) openStep = i;
  }

  function removeStep(job: Job, i: number) {
    job.steps = (job.steps ?? []).filter((_, n) => n !== i);
    openStep = null;
  }

  function setKind(step: Step, action: boolean) {
    if (action === isAction(step)) return;
    if (action) {
      delete step.run;
      step.uses = "";
    } else {
      delete step.uses;
      delete step.with;
      step.run = "";
    }
  }

  // Action inputs are strings to GitHub; true/false stay booleans so files read the way people write them.
  const coerce = (v: string) => (v === "true" ? true : v === "false" ? false : v);

  function setInput(step: Step, index: number, key: string, value: string | number | boolean) {
    const entries = Object.entries(step.with ?? {});
    entries[index] = [key, value];
    step.with = Object.fromEntries(entries);
  }

  function removeInput(step: Step, index: number) {
    step.with = Object.fromEntries(Object.entries(step.with ?? {}).filter((_, n) => n !== index));
  }

  // --- Runner ---

  const isCustomRunner = (job: Job) => !RUNNERS.some((r) => r.value === job.runsOn);

  function onKey(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    // Close the innermost thing that's open.
    if (addingJobAfter) addingJobAfter = null;
    else if (selected) selected = null;
    else {
      editingEvent = null;
      addingTrigger = false;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="builder">
  <!-- 1. Name and when it runs. -->
  <section class="card hero" aria-labelledby="when-heading">
    <input class="title-input" bind:value={model.name} aria-label="Workflow name" placeholder="Name this workflow" />
    <h3 id="when-heading" class="sr-only">When it runs</h3>
    <div class="trigger-row">
      <span class="runs-label">Runs</span>
      {#each events as event (event)}
        {@const spec = eventSpec(event)}
        {@const words = describeEvent(event, on[event])}
        <span class="chip-group" class:active={editingEvent === event}>
          <span class="codicon codicon-{spec?.icon ?? 'zap'} chip-icon" aria-hidden="true"></span>
          <button
            class="trigger-chip"
            aria-expanded={editingEvent === event}
            title={spec ? `${spec.label} (${event})` : event}
            onclick={() => {
              editingEvent = editingEvent === event ? null : event;
              addingTrigger = false;
            }}>{words}</button
          >
          <button class="chip-remove" aria-label="Remove: {words}" onclick={() => dropTrigger(event)}>
            <span class="codicon codicon-close"></span>
          </button>
        </span>
      {/each}
      <button
        class="add-chip"
        aria-expanded={addingTrigger}
        onclick={() => {
          addingTrigger = !addingTrigger;
          editingEvent = null;
        }}
      >
        <span class="codicon codicon-add"></span>Add a trigger
      </button>
    </div>

    {#if addingTrigger}
      <TriggerPicker used={events} {hasTags} onpick={pickTrigger} oncancel={() => (addingTrigger = false)} />
    {/if}

    {#if editingEvent && editingEvent in on}
      {#key editingEvent}
        <TriggerEditor
          event={editingEvent}
          config={on[editingEvent]}
          {workflowNames}
          onchange={(config) => updateOn({ ...on, [editingEvent!]: config })}
          ondone={() => (editingEvent = null)}
        />
      {/key}
    {/if}
  </section>

  <!-- 2. The jobs, left to right in the order they run. -->
  <section class="card" aria-labelledby="jobs-heading">
    <div class="card-head">
      <h3 id="jobs-heading">Jobs</h3>
      <span class="card-sub">Left to right in the order they run. Jobs in the same column run at the same time.</span>
    </div>

    {#if model.jobs.length === 0}
      <button class="ghost-card first-job" onclick={() => openPicker([])}>
        <span class="codicon codicon-add"></span>Add your first job
      </button>
    {:else}
      <div class="pipeline">
        <button class="add-start" title="Add a job that starts right away" onclick={() => openPicker([])}>
          <span class="codicon codicon-add"></span><span class="sr-only">Add a job that starts right away</span>
        </button>
        {#each columns as column, c (c)}
          <ol class="stage" aria-label="Step {c + 1}{c === 0 ? ', starts right away' : ', after the previous step'}">
            {#each column as job (job)}
              {@const look = jobLook(job)}
              {@const issues = problemsFor(job)}
              {@const cautions = warningsFor(job)}
              {@const when = describeCondition(job.extra?.if)}
              <li>
                <button
                  class="job-card group-{look.group}"
                  class:selected={selected === job}
                  class:problem={issues.length > 0}
                  class:caution={!issues.length && cautions.length > 0}
                  aria-pressed={selected === job}
                  onclick={() => edit(selected === job ? null : job)}
                >
                  <span class="job-icon codicon codicon-{look.icon}" aria-hidden="true"></span>
                  <span class="job-body">
                    <span class="job-name">{job.name}</span>
                    <span class="job-meta">{meta(job)}</span>
                    {#if when}
                      <span class="job-when" title="if: {job.extra?.if}"
                        ><span class="codicon codicon-filter" aria-hidden="true"></span>{when}</span
                      >
                    {/if}
                    {#if issues.length}
                      <span class="job-issue"><span class="codicon codicon-warning"></span>{issues[0].message}</span>
                    {:else if cautions.length}
                      <span class="job-caution"><span class="codicon codicon-warning"></span>{cautions[0].message}</span
                      >
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
            <li>
              <button class="ghost-card" onclick={() => openPicker(column.map((j) => j.id))}>
                <span class="codicon codicon-add"></span>Add a job after {column.length === 1
                  ? column[0].name
                  : "these"}
              </button>
            </li>
          </ol>
          {#if c < columns.length - 1}
            <span class="connector codicon codicon-arrow-right" aria-hidden="true"></span>
          {/if}
        {/each}
      </div>
    {/if}
  </section>

  <!-- 3. Safety settings. -->
  <section class="card" aria-labelledby="safety-heading">
    <div class="card-head"><h3 id="safety-heading">Safety</h3></div>
    <label class="toggle-row">
      <input type="checkbox" bind:checked={model.readOnlyPermissions} />
      <span>
        <span class="toggle-title">Read-only access by default</span>
        <span class="field-hint">Recommended. Jobs that need more, like publishing, get it for that job only.</span>
      </span>
    </label>
    <label class="toggle-row">
      <input type="checkbox" bind:checked={model.cancelSuperseded} />
      <span>
        <span class="toggle-title">Cancel outdated runs</span>
        <span class="field-hint">When a newer push arrives, stop the run for the older one.</span>
      </span>
    </label>
  </section>

  <WorkflowSettings bind:model bind:triggersOpen={triggersYamlOpen} />

  {#if general.length}
    <ul class="problems" aria-label="Problems to fix">
      {#each general as p, i (i)}<li><span class="codicon codicon-warning"></span>{p.message}</li>{/each}
    </ul>
  {/if}
</div>

<!-- Job picker: a dialog with search and a grid of tiles. -->
{#if addingJobAfter}
  <div class="overlay" role="presentation" onclick={() => (addingJobAfter = null)}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title" bind:this={picker}>
    <div class="dialog-head">
      <div>
        <h2 id="picker-title">Add a job</h2>
        <p class="field-hint">
          {addingJobAfter.length ? "It runs after the jobs before it." : "It starts as soon as the workflow runs."}
        </p>
      </div>
      <button class="icon-button" aria-label="Close" onclick={() => (addingJobAfter = null)}
        ><span class="codicon codicon-close"></span></button
      >
    </div>
    <label class="search-field">
      <span class="codicon codicon-search" aria-hidden="true"></span>
      <input placeholder="Search jobs" aria-label="Search jobs" bind:value={pickerSearch} />
    </label>
    <div class="dialog-body" role="group" aria-label="Choose a job to add">
      {#each GROUPS as group (group.id)}
        {@const items = templatesIn(group.id)}
        {#if items.length}
          <h3 class="tile-group">{group.label}</h3>
          <div class="tiles">
            {#each items as t (t.id)}
              <button class="tile group-{t.group}" onclick={() => addJob(t)}>
                <span class="job-icon codicon codicon-{t.icon}" aria-hidden="true"></span>
                <span class="tile-text">
                  <span class="tile-title">{t.label}</span>
                  <span class="tile-description">{t.description}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<!-- Job editor: a panel that slides in from the right. -->
{#if selected}
  {@const job = selected}
  {@const t = template(job.template)}
  {@const look = jobLook(job)}
  <div class="drawer" role="dialog" aria-label="Edit {job.name}" bind:this={drawer}>
    <div class="drawer-head">
      <span class="job-icon codicon codicon-{look.icon} group-{look.group}" aria-hidden="true"></span>
      <div class="drawer-title">
        <h2>{job.name}</h2>
        <p class="field-hint">{t.description}</p>
      </div>
      <button class="icon-button" aria-label="Close editor" onclick={() => (selected = null)}
        ><span class="codicon codicon-close"></span></button
      >
    </div>

    <div class="drawer-body">
      <label class="field">
        <span class="field-label">Name</span>
        <input bind:value={job.name} />
      </label>

      {#if typeof job.extra?.uses === "string"}
        <p class="notice kept">
          <span class="codicon codicon-references" aria-hidden="true"></span>
          <span>Calls the workflow <code>{job.extra.uses}</code>. Its settings are kept as written.</span>
        </p>
      {:else if job.extra?.["runs-on"] !== undefined}
        <div class="field">
          <span class="field-label">Runs on</span>
          <span class="kept-value mono">{runnerLabel(job)}</span>
          <span class="field-hint"
            >Kept as written in the file. <button
              class="link"
              onclick={() => {
                if (job.extra) delete job.extra["runs-on"];
              }}>Choose a runner instead</button
            ></span
          >
        </div>
      {:else}
        <div class="field">
          <span class="field-label" id="runner-label">Runs on</span>
          <div class="segmented" role="radiogroup" aria-labelledby="runner-label">
            {#each RUNNERS as r (r.value)}
              <button
                role="radio"
                aria-checked={job.runsOn === r.value}
                class:on={job.runsOn === r.value}
                onclick={() => (job.runsOn = r.value)}>{r.label}</button
              >
            {/each}
            <button
              role="radio"
              aria-checked={isCustomRunner(job)}
              class:on={isCustomRunner(job)}
              onclick={() => {
                if (!isCustomRunner(job)) job.runsOn = "self-hosted";
              }}>Other…</button
            >
          </div>
          {#if isCustomRunner(job)}
            <input class="mono" aria-label="Runner label" bind:value={job.runsOn} placeholder="self-hosted" />
            <span class="field-hint"
              >A runner label, like <code>self-hosted</code> or <code>ubuntu-24.04-arm</code>.</span
            >
          {/if}
        </div>
      {/if}

      {#if t.matrixKey && t.versionChoices}
        <div class="field">
          <span class="field-label" id="versions-label">Versions</span>
          <div class="segmented" role="group" aria-labelledby="versions-label">
            {#each t.versionChoices as v (v)}
              <button
                aria-pressed={job.versions.includes(v)}
                class:on={job.versions.includes(v)}
                onclick={() => toggleVersion(job, v)}>{v}</button
              >
            {/each}
          </div>
          <span class="field-hint">Each version runs as its own copy of the job.</span>
        </div>
      {/if}

      {#each t.inputs as input (input.key)}
        <label class="field">
          <span class="field-label"
            >{input.label}{#if input.optional}<span class="optional"> optional</span>{/if}</span
          >
          <input class="mono" bind:value={job.inputs[input.key]} placeholder={input.placeholder} />
        </label>
      {/each}

      {#if job.template === "steps" && typeof job.extra?.uses !== "string"}
        {@const steps = job.steps ?? []}
        <div class="field">
          <span class="field-label" id="steps-label">Steps</span>
          <ol class="steps" aria-labelledby="steps-label">
            {#each steps as step, i (step)}
              <li class="step-card" class:open={openStep === i}>
                <div class="step-row">
                  <button
                    class="step-toggle"
                    aria-expanded={openStep === i}
                    onclick={() => (openStep = openStep === i ? null : i)}
                  >
                    <span class="step-number">{i + 1}</span>
                    <span class="codicon codicon-{isAction(step) ? 'extensions' : 'terminal'}" aria-hidden="true"
                    ></span>
                    <span class="step-label">{stepLabel(step)}</span>
                  </button>
                  <button
                    class="icon-button"
                    aria-label="Move step {i + 1} up"
                    disabled={i === 0}
                    onclick={() => moveStep(job, i, -1)}><span class="codicon codicon-arrow-up"></span></button
                  >
                  <button
                    class="icon-button"
                    aria-label="Move step {i + 1} down"
                    disabled={i === steps.length - 1}
                    onclick={() => moveStep(job, i, 1)}><span class="codicon codicon-arrow-down"></span></button
                  >
                  <button class="icon-button" aria-label="Remove step {i + 1}" onclick={() => removeStep(job, i)}
                    ><span class="codicon codicon-trash"></span></button
                  >
                </div>
                {#if openStep === i}
                  <div class="step-fields">
                    <label class="field">
                      <span class="field-label">Name<span class="optional"> optional</span></span>
                      <input bind:value={step.name} placeholder={stepLabel({ ...step, name: undefined })} />
                    </label>
                    <div class="segmented" role="radiogroup" aria-label="Step {i + 1} kind">
                      <button
                        role="radio"
                        aria-checked={!isAction(step)}
                        class:on={!isAction(step)}
                        onclick={() => setKind(step, false)}>Command</button
                      >
                      <button
                        role="radio"
                        aria-checked={isAction(step)}
                        class:on={isAction(step)}
                        onclick={() => setKind(step, true)}>Action</button
                      >
                    </div>
                    {#if isAction(step)}
                      <label class="field">
                        <span class="field-label">Action</span>
                        <input class="mono" bind:value={step.uses} placeholder="owner/action@v1" />
                      </label>
                      <div class="field">
                        <span class="field-label">Inputs</span>
                        {#each Object.entries(step.with ?? {}) as [key, value], wi (wi)}
                          <div class="input-row">
                            <input
                              class="mono"
                              aria-label="Input name"
                              value={key}
                              onchange={(e) => setInput(step, wi, e.currentTarget.value.trim(), value)}
                            />
                            <input
                              class="mono"
                              aria-label="Value of {key || 'input'}"
                              value={String(value)}
                              oninput={(e) => setInput(step, wi, key, coerce(e.currentTarget.value))}
                            />
                            <button
                              class="icon-button"
                              aria-label="Remove input {key}"
                              onclick={() => removeInput(step, wi)}><span class="codicon codicon-close"></span></button
                            >
                          </div>
                        {/each}
                        {#if !("" in (step.with ?? {}))}
                          <button class="link" onclick={() => (step.with = { ...step.with, "": "" })}
                            ><span class="codicon codicon-add"></span>Add an input</button
                          >
                        {/if}
                      </div>
                    {:else}
                      <label class="field">
                        <span class="field-label">Command</span>
                        <textarea class="mono" rows="3" bind:value={step.run} placeholder="npm test"></textarea>
                        <span class="field-hint">Several lines run one after another.</span>
                      </label>
                    {/if}
                    <ConditionField
                      kind="step"
                      {branch}
                      value={typeof step.if === "string" ? step.if : ""}
                      onchange={(v) => {
                        if (v) step.if = v;
                        else delete step.if;
                      }}
                    />
                    <StepOptions {step} />
                    {#if otherKeys(step).length}
                      <span class="field-hint"
                        >Also set in the file, kept as written: {otherKeys(step).join(", ")}.</span
                      >
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ol>
          {#if granted.length}
            <p class="notice" role="status">
              <span class="codicon codicon-shield" aria-hidden="true"></span>
              <span>That step needs {granted.join(", ")}: given to this job only.</span>
            </p>
          {/if}
          {#if addingStep}
            <StepPicker onpick={(key) => addStep(job, key)} oncancel={() => (addingStep = false)} />
          {:else}
            <button class="ghost-card" onclick={() => (addingStep = true)}
              ><span class="codicon codicon-add"></span>Add a step</button
            >
          {/if}
        </div>
      {:else if job.template !== "steps"}
        <div class="field">
          <button class="secondary customize" onclick={() => customize(job)}
            ><span class="codicon codicon-list-ordered"></span>Customize the steps</button
          >
          <span class="field-hint">Shows every step this job runs, so you can change, reorder or add to them.</span>
        </div>
      {/if}

      {#if keptKeys(job).length}
        <p class="notice kept">
          <span class="codicon codicon-lock" aria-hidden="true"></span>
          <span
            >Also in this job, kept as is: {keptKeys(job).join(", ")}. Edit them under More options → Job settings as
            YAML.</span
          >
        </p>
      {/if}

      {#if model.jobs.length > 1}
        <div class="field">
          <span class="field-label" id="needs-label">Runs after</span>
          <div class="segmented" role="group" aria-labelledby="needs-label">
            {#each model.jobs.filter((j) => j !== job) as other (other)}
              <button
                aria-pressed={job.needs.includes(other.id)}
                class:on={job.needs.includes(other.id)}
                onclick={() => toggleNeed(job, other.id)}>{other.name}</button
              >
            {/each}
          </div>
        </div>
      {/if}

      <ConditionField
        kind="job"
        {branch}
        value={typeof job.extra?.if === "string" ? job.extra.if : ""}
        onchange={(v) => setCondition(job, v)}
      />
      {#each warningsFor(job) as w (w.message)}
        <p class="notice caution" role="status">
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          <span
            >{w.message}{#if w.fix}
              <button class="link" onclick={() => setCondition(job, w.fix!.condition)}>{w.fix.label}</button>{/if}</span
          >
        </p>
      {/each}

      {#if t.permissions}
        <p class="notice">
          <span class="codicon codicon-shield" aria-hidden="true"></span>
          <span
            >This job gets extra access: {Object.entries(t.permissions)
              .map(([k, v]) => `${k} (${v})`)
              .join(", ")}. Only this job, not the rest of the workflow.</span
          >
        </p>
      {/if}

      <!-- Keyed: its rows (matrix, services) are read once, from the job it was opened for. -->
      {#key job}
        <JobOptions {job} onrename={(id) => renameId(job, id)} />
      {/key}
    </div>

    <div class="drawer-foot">
      <button class="danger-link" onclick={() => removeJob(job)}
        ><span class="codicon codicon-trash"></span>Remove job</button
      >
      <button class="primary" onclick={() => (selected = null)}>Done</button>
    </div>
  </div>
{/if}

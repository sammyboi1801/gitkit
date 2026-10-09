<script lang="ts">
  import { tick } from "svelte";
  import {
    RUNNERS,
    TEMPLATES,
    WEEKDAYS,
    addPreset,
    cronFor,
    describeSchedule,
    newJob,
    scheduleSpec,
    stages,
    template,
    toOwnSteps,
    type Frequency,
    type Job,
    type Problem,
    type ScheduleSpec,
    type Stack,
    type Step,
    type Template,
    type Triggers,
    type WorkflowModel,
  } from "../../src/workflow/model";
  import JobOptions from "./JobOptions.svelte";
  import StepOptions from "./StepOptions.svelte";
  import StepPicker from "./StepPicker.svelte";
  import WorkflowSettings from "./WorkflowSettings.svelte";

  let {
    model = $bindable(),
    problems,
    stacks,
  }: { model: WorkflowModel; problems: Problem[]; stacks: Stack[] } = $props();

  type TriggerKey = "push" | "pullRequest" | "tags" | "schedule" | "manual";
  const TRIGGERS: { key: TriggerKey; add: string; icon: string }[] = [
    { key: "push", add: "When code is pushed", icon: "repo-push" },
    { key: "pullRequest", add: "On pull requests", icon: "git-pull-request" },
    { key: "tags", add: "When a version tag is pushed", icon: "tag" },
    { key: "schedule", add: "On a schedule", icon: "watch" },
    { key: "manual", add: "With a Run button on GitHub", icon: "play" },
  ];
  const GROUPS: { id: Template["group"]; label: string }[] = [
    { id: "check", label: "Check the code" },
    { id: "build", label: "Build" },
    { id: "ship", label: "Ship it" },
    { id: "other", label: "Anything else" },
  ];

  let editingTrigger: TriggerKey | null = $state(null);
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
  /** The person chose "Custom" for the schedule, so the cron field shows even for a simple cron. */
  let customCron = $state(false);
  /** Access the last added step needed, granted to its job: said once, under the steps. */
  let granted: string[] = $state([]);
  /** The "Triggers as YAML" box in More settings, opened by "Something else…". */
  let triggersYamlOpen = $state(false);
  let settingsCard: HTMLElement | undefined = $state();

  const FREQUENCIES: { value: Frequency; label: string }[] = [
    { value: "hourly", label: "Every hour" },
    { value: "daily", label: "Every day" },
    { value: "weekly", label: "Every week" },
    { value: "monthly", label: "Every month" },
  ];
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  const DAYS = Array.from({ length: 28 }, (_, d) => d + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ordinal = (d: number) =>
    `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
  /** Every five minutes, plus whatever odd minute the cron already uses. */
  const minutes = (current: number) =>
    [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), current])].sort((a, b) => a - b);
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

  const isOn = (key: TriggerKey) => (key === "manual" ? model.triggers.manual : model.triggers[key].enabled);
  const active = $derived(TRIGGERS.filter((t) => isOn(t.key)));
  const columns = $derived(stages(model.jobs).map((ids) => ids.map((id) => model.jobs.find((j) => j.id === id)!)));
  const problemsFor = (job: Job) => problems.filter((p) => p.job === job.id);
  const general = $derived(problems.filter((p) => !p.job));

  function chipText(key: TriggerKey, t: Triggers): string {
    switch (key) {
      case "push":
        return t.push.branches.length ? `on pushes to ${t.push.branches.join(", ")}` : "on every push";
      case "pullRequest":
        return t.pullRequest.branches.length
          ? `on pull requests into ${t.pullRequest.branches.join(", ")}`
          : "on pull requests";
      case "tags":
        return `on tags like ${t.tags.pattern}`;
      case "schedule":
        return describeSchedule(t.schedule.cron);
      case "manual":
        return "with a Run button";
    }
  }

  function setTrigger(key: TriggerKey, on: boolean) {
    if (key === "manual") model.triggers.manual = on;
    else model.triggers[key].enabled = on;
    editingTrigger = on && key !== "manual" ? key : null;
    addingTrigger = false;
  }

  const list = (value: string) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

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

  async function otherTriggers() {
    addingTrigger = false;
    triggersYamlOpen = true;
    await tick();
    settingsCard?.scrollIntoView?.({ block: "nearest" });
    settingsCard?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
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

  // --- Schedule ---

  const DEFAULT_SPEC: ScheduleSpec = { frequency: "daily", minute: 0, hour: 6, weekday: 1, day: 1 };

  function setSchedule(patch: Partial<ScheduleSpec>) {
    const spec = scheduleSpec(model.triggers.schedule.cron) ?? DEFAULT_SPEC;
    model.triggers.schedule.cron = cronFor({ ...spec, ...patch });
  }

  function setFrequency(value: string) {
    customCron = value === "custom";
    if (!customCron) setSchedule({ frequency: value as Frequency });
  }

  // --- Triggers kept from a file ---

  /** Event names in triggers Studio kept as written, e.g. ["push", "release"]. */
  const rawEvents = $derived.by(() => {
    const on = model.rawOn;
    if (on === undefined) return [];
    if (typeof on === "string") return [on];
    if (Array.isArray(on)) return on.map(String);
    return on && typeof on === "object" ? Object.keys(on) : [];
  });

  function onKey(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    // Close the innermost thing that's open.
    if (addingJobAfter) addingJobAfter = null;
    else if (selected) selected = null;
    else {
      editingTrigger = null;
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
      {#if model.rawOn !== undefined}
        <span
          class="chip-group kept"
          title="These triggers use options the builder doesn't show, so they're saved exactly as written."
        >
          <span class="codicon codicon-lock chip-icon" aria-hidden="true"></span>
          <span class="trigger-chip">on {rawEvents.join(", ") || "custom events"} (kept as written)</span>
        </span>
        <button class="add-chip" onclick={otherTriggers}>
          <span class="codicon codicon-code"></span>Edit as YAML
        </button>
        <button class="add-chip" onclick={() => (model.rawOn = undefined)}>
          <span class="codicon codicon-edit"></span>Replace with simple triggers
        </button>
      {/if}
      {#each model.rawOn === undefined ? active : [] as t (t.key)}
        <span class="chip-group" class:active={editingTrigger === t.key}>
          <span class="codicon codicon-{t.icon} chip-icon" aria-hidden="true"></span>
          <button
            class="trigger-chip"
            aria-expanded={t.key === "manual" ? undefined : editingTrigger === t.key}
            disabled={t.key === "manual"}
            onclick={() => (editingTrigger = editingTrigger === t.key ? null : t.key)}
          >
            {chipText(t.key, model.triggers)}
          </button>
          <button
            class="chip-remove"
            aria-label="Remove: {chipText(t.key, model.triggers)}"
            onclick={() => setTrigger(t.key, false)}
          >
            <span class="codicon codicon-close"></span>
          </button>
        </span>
      {/each}
      {#if model.rawOn === undefined}
        <button class="add-chip" aria-expanded={addingTrigger} onclick={() => (addingTrigger = !addingTrigger)}>
          <span class="codicon codicon-add"></span>Add a trigger
        </button>
      {/if}
    </div>

    {#if addingTrigger}
      <div class="trigger-options" role="group" aria-label="Add a trigger">
        {#each TRIGGERS.filter((t) => !isOn(t.key)) as t (t.key)}
          <button class="option" onclick={() => setTrigger(t.key, true)}>
            <span class="codicon codicon-{t.icon}" aria-hidden="true"></span>{t.add}
          </button>
        {/each}
        <button class="option" onclick={otherTriggers}>
          <span class="codicon codicon-code" aria-hidden="true"></span>Something else (releases, issues, other
          workflows…)
        </button>
      </div>
    {/if}

    {#if editingTrigger}
      <div class="trigger-editor">
        {#if editingTrigger === "push"}
          <label class="field">
            <span class="field-label">Branches</span>
            <input
              class="mono"
              placeholder="every branch"
              value={model.triggers.push.branches.join(", ")}
              oninput={(e) => (model.triggers.push.branches = list(e.currentTarget.value))}
            />
            <span class="field-hint">Comma-separated. Leave empty to run on every branch.</span>
          </label>
        {:else if editingTrigger === "pullRequest"}
          <label class="field">
            <span class="field-label">Into branches</span>
            <input
              class="mono"
              placeholder="any branch"
              value={model.triggers.pullRequest.branches.join(", ")}
              oninput={(e) => (model.triggers.pullRequest.branches = list(e.currentTarget.value))}
            />
            <span class="field-hint">Leave empty for pull requests into any branch.</span>
          </label>
        {:else if editingTrigger === "tags"}
          <label class="field">
            <span class="field-label">Tag pattern</span>
            <input class="mono short" bind:value={model.triggers.tags.pattern} />
            <span class="field-hint"><code>v*</code> matches v1.0, v2.3.1 and so on.</span>
          </label>
        {:else if editingTrigger === "schedule"}
          {@const spec = customCron ? null : scheduleSpec(model.triggers.schedule.cron)}
          <div class="schedule-row">
            <label class="field">
              <span class="field-label">How often</span>
              <select value={spec?.frequency ?? "custom"} onchange={(e) => setFrequency(e.currentTarget.value)}>
                {#each FREQUENCIES as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
                <option value="custom">Custom (cron)</option>
              </select>
            </label>
            {#if spec?.frequency === "weekly"}
              <label class="field">
                <span class="field-label">On</span>
                <select value={spec.weekday} onchange={(e) => setSchedule({ weekday: Number(e.currentTarget.value) })}>
                  {#each WEEKDAYS as day, i (day)}<option value={i}>{day}</option>{/each}
                </select>
              </label>
            {:else if spec?.frequency === "monthly"}
              <label class="field">
                <span class="field-label">On the</span>
                <select value={spec.day} onchange={(e) => setSchedule({ day: Number(e.currentTarget.value) })}>
                  {#each DAYS as d (d)}<option value={d}>{ordinal(d)}</option>{/each}
                </select>
              </label>
            {/if}
            {#if spec && spec.frequency !== "hourly"}
              <div class="field">
                <span class="field-label" id="time-label">At (UTC)</span>
                <span class="time" role="group" aria-labelledby="time-label">
                  <select
                    aria-label="Hour"
                    value={spec.hour}
                    onchange={(e) => setSchedule({ hour: Number(e.currentTarget.value) })}
                  >
                    {#each HOURS as h (h)}<option value={h}>{pad(h)}</option>{/each}
                  </select>
                  :
                  <select
                    aria-label="Minute"
                    value={spec.minute}
                    onchange={(e) => setSchedule({ minute: Number(e.currentTarget.value) })}
                  >
                    {#each minutes(spec.minute) as m (m)}<option value={m}>{pad(m)}</option>{/each}
                  </select>
                </span>
              </div>
            {:else if spec}
              <label class="field">
                <span class="field-label">At minute</span>
                <select value={spec.minute} onchange={(e) => setSchedule({ minute: Number(e.currentTarget.value) })}>
                  {#each minutes(spec.minute) as m (m)}<option value={m}>:{pad(m)}</option>{/each}
                </select>
              </label>
            {/if}
          </div>
          <label class="field">
            <span class="field-label">Cron expression</span>
            <input class="mono short" spellcheck="false" bind:value={model.triggers.schedule.cron} />
            <span class="field-hint"
              >{describeSchedule(model.triggers.schedule.cron)}. Fields: minute hour day-of-month month day-of-week, in
              UTC; * means every.</span
            >
          </label>
          <span class="field-hint">GitHub may start scheduled runs a few minutes late when it's busy.</span>
        {/if}
        <button class="done-link" onclick={() => (editingTrigger = null)}>Done</button>
      </div>
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
              {@const t = template(job.template)}
              {@const issues = problemsFor(job)}
              <li>
                <button
                  class="job-card group-{t.group}"
                  class:selected={selected === job}
                  class:problem={issues.length > 0}
                  aria-pressed={selected === job}
                  onclick={() => edit(selected === job ? null : job)}
                >
                  <span class="job-icon codicon codicon-{t.icon}" aria-hidden="true"></span>
                  <span class="job-body">
                    <span class="job-name">{job.name}</span>
                    <span class="job-meta">{meta(job)}</span>
                    {#if issues.length}
                      <span class="job-issue"><span class="codicon codicon-warning"></span>{issues[0].message}</span>
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

  <div bind:this={settingsCard}>
    <WorkflowSettings bind:model bind:triggersOpen={triggersYamlOpen} />
  </div>

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
  <div class="drawer" role="dialog" aria-label="Edit {job.name}" bind:this={drawer}>
    <div class="drawer-head">
      <span class="job-icon codicon codicon-{t.icon} group-{t.group}" aria-hidden="true"></span>
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
                    <label class="field">
                      <span class="field-label">Only if<span class="optional"> optional</span></span>
                      <input class="mono" bind:value={step.if} placeholder="github.ref == 'refs/heads/main'" />
                    </label>
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

<script lang="ts">
  import {
    RUNNERS,
    SCHEDULES,
    TEMPLATES,
    describeSchedule,
    newJob,
    stages,
    template,
    type Job,
    type Problem,
    type Stack,
    type Template,
    type Triggers,
    type WorkflowModel,
  } from "../../src/workflow/model";

  let {
    model = $bindable(),
    problems,
    stacks,
  }: { model: WorkflowModel; problems: Problem[]; stacks: Stack[] } = $props();

  type TriggerKey = "push" | "pullRequest" | "tags" | "schedule" | "manual";
  const TRIGGERS: { key: TriggerKey; add: string }[] = [
    { key: "push", add: "When code is pushed" },
    { key: "pullRequest", add: "On pull requests" },
    { key: "tags", add: "When a version tag is pushed" },
    { key: "schedule", add: "On a schedule" },
    { key: "manual", add: "With a Run button on GitHub" },
  ];
  const GROUPS: { id: Template["group"]; label: string }[] = [
    { id: "check", label: "Check the code" },
    { id: "build", label: "Build" },
    { id: "ship", label: "Ship it" },
    { id: "other", label: "Anything else" },
  ];

  let editingTrigger: TriggerKey | null = $state(null);
  let addingTrigger = $state(false);
  /** Where a new job goes: the ids it should run after (empty: at the start, in parallel). */
  let addingJobAfter: string[] | null = $state(null);
  let selected: Job | null = $state(null);

  const isOn = (key: TriggerKey) => (key === "manual" ? model.triggers.manual : model.triggers[key].enabled);
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

  // Templates for this project's stack first, then the rest.
  function templatesIn(group: Template["group"]): Template[] {
    const fit = (t: Template) => (t.stack === null || stacks.includes(t.stack) ? 0 : 1);
    return TEMPLATES.filter((t) => t.group === group).sort((a, b) => fit(a) - fit(b));
  }

  function addJob(t: Template) {
    const job = newJob(t.id, model.jobs);
    job.needs = [...(addingJobAfter ?? [])];
    model.jobs.push(job);
    addingJobAfter = null;
    selected = model.jobs[model.jobs.length - 1];
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

  function summary(job: Job): string {
    const t = template(job.template);
    const runner = RUNNERS.find((r) => r.value === job.runsOn)?.label ?? job.runsOn;
    const versions = t.matrixKey && job.versions.length ? ` · ${job.versions.join(", ")}` : "";
    const command = job.inputs.command ?? job.inputs.build ?? "";
    return `${runner}${versions}${command ? ` · ${command}` : ""}`;
  }
</script>

<div class="builder">
  <!-- 1. When it runs, as a sentence. -->
  <section class="card sentence" aria-labelledby="when-heading">
    <h3 id="when-heading">When it runs</h3>
    <p class="sentence-line">
      <input
        class="name-input"
        bind:value={model.name}
        aria-label="Workflow name"
        size={Math.max(model.name.length, 4)}
      />
      <span>runs</span>
      {#each TRIGGERS.filter((t) => isOn(t.key)) as t, i (t.key)}
        {#if i > 0}<span class="muted">{i === TRIGGERS.filter((x) => isOn(x.key)).length - 1 ? "and" : ","}</span>{/if}
        <span class="chip-group">
          <button
            class="trigger-chip"
            class:active={editingTrigger === t.key}
            aria-expanded={editingTrigger === t.key}
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
      {#if TRIGGERS.some((t) => !isOn(t.key))}
        <button class="add-chip" aria-expanded={addingTrigger} onclick={() => (addingTrigger = !addingTrigger)}>
          <span class="codicon codicon-add"></span>Add a trigger
        </button>
      {/if}
    </p>

    {#if addingTrigger}
      <div class="options" role="group" aria-label="Add a trigger">
        {#each TRIGGERS.filter((t) => !isOn(t.key)) as t (t.key)}
          <button onclick={() => setTrigger(t.key, true)}>{t.add}</button>
        {/each}
      </div>
    {/if}

    {#if editingTrigger === "push"}
      <label class="field">
        Branches <span class="muted">(comma-separated; leave empty for every branch)</span>
        <input
          class="mono"
          placeholder="every branch"
          value={model.triggers.push.branches.join(", ")}
          oninput={(e) => (model.triggers.push.branches = list(e.currentTarget.value))}
        />
      </label>
    {:else if editingTrigger === "pullRequest"}
      <label class="field">
        Into branches <span class="muted">(leave empty for any branch)</span>
        <input
          class="mono"
          placeholder="any branch"
          value={model.triggers.pullRequest.branches.join(", ")}
          oninput={(e) => (model.triggers.pullRequest.branches = list(e.currentTarget.value))}
        />
      </label>
    {:else if editingTrigger === "tags"}
      <label class="field">
        Tag pattern <span class="muted">(v* matches v1.0, v2.3.1…)</span>
        <input class="mono" bind:value={model.triggers.tags.pattern} />
      </label>
    {:else if editingTrigger === "schedule"}
      <div class="field">
        <span id="schedule-label">How often</span>
        <div class="segmented" role="radiogroup" aria-labelledby="schedule-label">
          {#each SCHEDULES as s (s.cron)}
            <button
              role="radio"
              aria-checked={model.triggers.schedule.cron === s.cron}
              class:on={model.triggers.schedule.cron === s.cron}
              onclick={() => (model.triggers.schedule.cron = s.cron)}>{s.label}</button
            >
          {/each}
        </div>
        <label class="inline-label">
          Or a custom cron <span class="muted">(minute hour day month weekday, in UTC)</span>
          <input class="mono short" bind:value={model.triggers.schedule.cron} />
        </label>
      </div>
    {/if}
  </section>

  <!-- 2. The jobs, left to right in the order they run. -->
  <section class="card" aria-labelledby="jobs-heading">
    <h3 id="jobs-heading">What it does</h3>
    {#if model.jobs.length === 0}
      <button class="first-job" onclick={() => (addingJobAfter = [])}>
        <span class="codicon codicon-add"></span>Add your first job
      </button>
    {:else}
      <div class="pipeline">
        <div class="stage-add">
          <button class="add-in-stage" title="Add a job that starts right away" onclick={() => (addingJobAfter = [])}>
            <span class="codicon codicon-add"></span><span class="sr-only">Add a job that starts right away</span>
          </button>
        </div>
        {#each columns as column, c (c)}
          <ol class="stage" aria-label="Step {c + 1}{c === 0 ? ', starts right away' : ', after the previous step'}">
            {#each column as job (job)}
              {@const issues = problemsFor(job)}
              <li>
                <button
                  class="job-card"
                  class:selected={selected === job}
                  class:problem={issues.length > 0}
                  aria-pressed={selected === job}
                  onclick={() => (selected = selected === job ? null : job)}
                >
                  <span class="job-card-title">{job.name}</span>
                  <span class="job-card-kind">{template(job.template).label}</span>
                  <span class="job-card-summary">{summary(job)}</span>
                  {#if issues.length}<span class="job-card-issue"
                      ><span class="codicon codicon-warning"></span>{issues[0].message}</span
                    >{/if}
                </button>
              </li>
            {/each}
            <li>
              <button class="add-after" onclick={() => (addingJobAfter = column.map((j) => j.id))}>
                <span class="codicon codicon-add"></span>Add a job after {column.length === 1
                  ? column[0].name
                  : "these"}
              </button>
            </li>
          </ol>
          {#if c < columns.length - 1}<span class="stage-arrow codicon codicon-arrow-right" aria-hidden="true"
            ></span>{/if}
        {/each}
      </div>
    {/if}

    {#if addingJobAfter}
      <div class="job-picker" role="group" aria-label="Choose a job to add">
        <div class="picker-head">
          <b>{addingJobAfter.length ? "Add a job that runs after the previous step" : "Add a job"}</b>
          <button class="icon-button" aria-label="Cancel" onclick={() => (addingJobAfter = null)}
            ><span class="codicon codicon-close"></span></button
          >
        </div>
        {#each GROUPS as group (group.id)}
          <div class="picker-group">
            <span class="picker-label">{group.label}</span>
            {#each templatesIn(group.id) as t (t.id)}
              <button class="picker-item" onclick={() => addJob(t)}>
                <span class="picker-title">{t.label}</span>
                <span class="muted">{t.description}</span>
              </button>
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    {#if selected}
      {@const job = selected}
      {@const t = template(job.template)}
      <div class="job-editor" role="region" aria-label="Edit {job.name}">
        <div class="picker-head">
          <b>{job.name}</b>
          <span class="muted">{t.description}</span>
        </div>
        <div class="field-row">
          <label class="field">Name <input bind:value={job.name} /></label>
          <label class="field"
            >Id in the YAML <input
              class="mono"
              value={job.id}
              onchange={(e) => renameId(job, e.currentTarget.value.trim())}
            /></label
          >
        </div>

        <div class="field">
          <span id="runner-label">Runs on</span>
          <div class="segmented" role="radiogroup" aria-labelledby="runner-label">
            {#each RUNNERS as r (r.value)}
              <button
                role="radio"
                aria-checked={job.runsOn === r.value}
                class:on={job.runsOn === r.value}
                onclick={() => (job.runsOn = r.value)}>{r.label}</button
              >
            {/each}
          </div>
        </div>

        {#if t.matrixKey && t.versionChoices}
          <div class="field">
            <span id="versions-label">Test on these versions <span class="muted">(each runs separately)</span></span>
            <div class="segmented" role="group" aria-labelledby="versions-label">
              {#each t.versionChoices as v (v)}
                <button
                  aria-pressed={job.versions.includes(v)}
                  class:on={job.versions.includes(v)}
                  onclick={() => toggleVersion(job, v)}>{v}</button
                >
              {/each}
            </div>
          </div>
        {/if}

        {#each t.inputs as input (input.key)}
          <label class="field">
            {input.label}{#if input.optional}<span class="muted"> (optional)</span>{/if}
            <input class="mono" bind:value={job.inputs[input.key]} placeholder={input.placeholder} />
          </label>
        {/each}

        {#if model.jobs.length > 1}
          <div class="field">
            <span id="needs-label">Runs after</span>
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
          <p class="muted small">
            <span class="codicon codicon-shield"></span>This job gets extra access: {Object.entries(t.permissions)
              .map(([k, v]) => `${k} (${v})`)
              .join(", ")}. Only this job, not the rest of the workflow.
          </p>
        {/if}

        <div class="editor-actions">
          <button class="danger-link" onclick={() => removeJob(job)}
            ><span class="codicon codicon-trash"></span>Remove this job</button
          >
          <button class="primary" onclick={() => (selected = null)}>Done</button>
        </div>
      </div>
    {/if}
  </section>

  <!-- 3. Safety settings. -->
  <section class="card" aria-labelledby="safety-heading">
    <h3 id="safety-heading">Safety</h3>
    <label class="check">
      <input type="checkbox" bind:checked={model.readOnlyPermissions} />
      Read-only access to the repo by default <span class="muted">(recommended; jobs that need more ask for it)</span>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={model.cancelSuperseded} />
      Cancel an older run when a newer push arrives
    </label>
  </section>

  {#if general.length}
    <ul class="problems" aria-label="Problems to fix">
      {#each general as p, i (i)}<li><span class="codicon codicon-warning"></span>{p.message}</li>{/each}
    </ul>
  {/if}
</div>

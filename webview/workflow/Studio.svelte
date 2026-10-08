<script lang="ts">
  import { onMount } from "svelte";
  import type { HostToStudio, WorkflowFile } from "../../src/shared/messages";
  import {
    TEMPLATES,
    newJob,
    template,
    validate,
    type Job,
    type Runner,
    type TemplateId,
    type WorkflowModel,
  } from "../../src/workflow/model";
  import { toYaml, type Explanation } from "../../src/workflow/yaml";
  import { send } from "./api";
  import Flow from "./Flow.svelte";

  type Mode =
    | { kind: "loading" }
    | { kind: "build"; file: string | null }
    | { kind: "explain"; file: string; explanation: Explanation; model: WorkflowModel | null; editedByHand: boolean };

  let mode: Mode = $state({ kind: "loading" });
  let model: WorkflowModel | null = $state(null);
  let suggestion: WorkflowModel | null = null;
  let files: WorkflowFile[] = $state([]);
  let repoName = $state("");
  let error: string | null = $state(null);
  let savedNote: string | null = $state(null);
  let copied = $state(false);
  let addTemplate: TemplateId = $state("custom");

  const problems = $derived(model ? validate(model) : []);
  const problemJobs = $derived(new Set(problems.filter((p) => p.job).map((p) => p.job!)));
  const yaml = $derived(model ? toYaml(model).replace(/\n# gitkit-model: .*\n$/, "\n") : "");

  const RUNNERS: Runner[] = ["ubuntu-latest", "windows-latest", "macos-latest"];
  const SCHEDULES = [
    { label: "Every day at 06:00 UTC", cron: "0 6 * * *" },
    { label: "Every Monday at 06:00 UTC", cron: "0 6 * * 1" },
    { label: "Every hour", cron: "0 * * * *" },
    { label: "Every night at 02:00 UTC", cron: "0 2 * * *" },
  ];

  const list = (value: string) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  function startNew(fromSuggestion = true) {
    if (fromSuggestion && suggestion) model = structuredClone($state.snapshot(suggestion) as WorkflowModel);
    mode = { kind: "build", file: null };
    savedNote = null;
  }

  function addJob() {
    if (!model) return;
    model.jobs.push(newJob(addTemplate, model.jobs));
  }

  function removeJob(job: Job) {
    if (!model) return;
    model.jobs = model.jobs.filter((j) => j !== job);
    for (const j of model.jobs) j.needs = j.needs.filter((n) => n !== job.id);
  }

  function renameJob(job: Job, id: string) {
    if (!model) return;
    for (const j of model.jobs) j.needs = j.needs.map((n) => (n === job.id ? id : n));
    job.id = id;
  }

  function toggleNeed(job: Job, id: string, on: boolean) {
    job.needs = on ? [...job.needs, id] : job.needs.filter((n) => n !== id);
  }

  async function copyYaml() {
    await navigator.clipboard.writeText(yaml);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function onPick(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "") startNew();
    else send({ type: "open", file: value });
  }

  onMount(() => {
    const onMessage = (event: MessageEvent<HostToStudio>) => {
      const message = event.data;
      error = null;
      if (message.type === "init") {
        repoName = message.repoName;
        files = message.files;
        suggestion = message.suggestion;
        startNew();
      } else if (message.type === "opened") {
        if (message.model && !message.editedByHand) {
          model = message.model;
          mode = { kind: "build", file: message.file };
        } else {
          mode = { kind: "explain", ...message };
        }
      } else if (message.type === "saved") {
        files = message.files;
        mode = { kind: "build", file: message.file };
        savedNote = `Saved .github/workflows/${message.file}`;
      } else if (message.type === "error") error = message.message;
    };
    window.addEventListener("message", onMessage);
    send({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  });
</script>

<main class="studio">
  <header class="studio-bar">
    <span class="codicon codicon-github-action accent"></span>
    <b>Workflow Studio</b>
    <span class="muted">{repoName}</span>
    <span class="spacer"></span>
    <label class="muted" for="pick">Workflow</label>
    <select
      id="pick"
      onchange={onPick}
      value={mode.kind === "build" || mode.kind === "explain" ? (mode.file ?? "") : ""}
    >
      <option value="">New workflow</option>
      {#each files as f (f.file)}
        <option value={f.file}>{f.file}{f.byGitKit ? "" : " (hand-written)"}</option>
      {/each}
    </select>
    {#if mode.kind === "build" && model}
      <button
        class="primary"
        disabled={problems.length > 0}
        onclick={() => send({ type: "save", model: $state.snapshot(model) as WorkflowModel })}
      >
        <span class="codicon codicon-save"></span>Save {model.file}
      </button>
    {/if}
  </header>

  {#if error}
    <div class="banner" role="alert">
      <span class="codicon codicon-error"></span>
      <div class="banner-body"><p>{error}</p></div>
      <button class="icon-button" title="Dismiss" onclick={() => (error = null)}
        ><span class="codicon codicon-close"></span></button
      >
    </div>
  {/if}

  {#if mode.kind === "loading"}
    <p class="muted pad">Looking at your project…</p>
  {:else if mode.kind === "explain"}
    {@const ex = mode.explanation}
    <section class="explain">
      <h2>{mode.file}</h2>
      {#if ex.error}
        <p class="error">This file isn't valid YAML: {ex.error}</p>
      {:else}
        <p class="lead">
          <b>{ex.name}</b> runs {ex.triggers.length ? ex.triggers.join(", ") : "on nothing (no triggers found)"}.
        </p>
        <Flow jobs={ex.jobs} />
        <div class="explain-jobs">
          {#each ex.jobs as job (job.id)}
            <div class="explain-job">
              <div class="job-title">
                <b>{job.name}</b>
                <span class="muted">on {job.runsOn}</span>
                {#if job.needs.length}<span class="muted">· after {job.needs.join(", ")}</span>{/if}
              </div>
              {#if job.matrix}<div class="muted">for each {job.matrix}</div>{/if}
              <ol>
                {#each job.steps as step, i (i)}<li>{step}</li>{/each}
              </ol>
            </div>
          {/each}
        </div>
      {/if}
      <div class="explain-actions">
        <button onclick={() => send({ type: "openFile", file: mode.kind === "explain" ? mode.file : "" })}>
          <span class="codicon codicon-go-to-file"></span>Open the file
        </button>
        {#if mode.model}
          <button
            onclick={() => {
              if (mode.kind !== "explain" || !mode.model) return;
              model = mode.model;
              mode = { kind: "build", file: mode.file };
            }}
          >
            <span class="codicon codicon-edit"></span>Edit visually (replaces hand edits)
          </button>
        {/if}
        <button onclick={() => startNew()}><span class="codicon codicon-add"></span>Start a new workflow instead</button
        >
      </div>
      {#if mode.editedByHand}
        <p class="hint">This file was made in Workflow Studio, then edited by hand. Showing it as-is.</p>
      {/if}
    </section>
  {:else if model}
    <div class="studio-body">
      <section class="builder">
        <div class="card">
          <h3>Basics</h3>
          <div class="field-row">
            <label>Name <input bind:value={model.name} placeholder="CI" /></label>
            <label>File <input bind:value={model.file} placeholder="ci.yml" class="mono" /></label>
          </div>
        </div>

        <div class="card">
          <h3>When it runs</h3>
          <label class="check">
            <input type="checkbox" bind:checked={model.triggers.push.enabled} />
            On push to
            <input
              class="inline mono"
              placeholder="all branches"
              value={model.triggers.push.branches.join(", ")}
              disabled={!model.triggers.push.enabled}
              oninput={(e) => model && (model.triggers.push.branches = list(e.currentTarget.value))}
            />
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={model.triggers.pullRequest.enabled} />
            On pull requests into
            <input
              class="inline mono"
              placeholder="any branch"
              value={model.triggers.pullRequest.branches.join(", ")}
              disabled={!model.triggers.pullRequest.enabled}
              oninput={(e) => model && (model.triggers.pullRequest.branches = list(e.currentTarget.value))}
            />
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={model.triggers.tags.enabled} />
            On tags matching
            <input
              class="inline mono"
              bind:value={model.triggers.tags.pattern}
              disabled={!model.triggers.tags.enabled}
            />
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={model.triggers.schedule.enabled} />
            On a schedule
            <select
              disabled={!model.triggers.schedule.enabled}
              value={SCHEDULES.find((s) => s.cron === model?.triggers.schedule.cron)?.cron ?? "custom"}
              onchange={(e) => {
                if (model && e.currentTarget.value !== "custom") model.triggers.schedule.cron = e.currentTarget.value;
              }}
            >
              {#each SCHEDULES as s (s.cron)}<option value={s.cron}>{s.label}</option>{/each}
              <option value="custom">Custom cron…</option>
            </select>
            <input
              class="inline mono short"
              bind:value={model.triggers.schedule.cron}
              disabled={!model.triggers.schedule.enabled}
            />
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={model.triggers.manual} />
            With a "Run workflow" button on GitHub
          </label>
        </div>

        <div class="card">
          <h3>Jobs</h3>
          {#each model.jobs as job (job)}
            {@const t = template(job.template)}
            <div class="job" class:problem={problemJobs.has(job.id)}>
              <div class="job-head">
                <input class="job-name" bind:value={job.name} aria-label="Job name" />
                <input
                  class="mono job-id"
                  value={job.id}
                  aria-label="Job id"
                  title="The job's id in the YAML"
                  onchange={(e) => renameJob(job, e.currentTarget.value.trim())}
                />
                <span class="pill">{t.label}</span>
                <button class="icon-button" title="Remove job" onclick={() => removeJob(job)}
                  ><span class="codicon codicon-trash"></span></button
                >
              </div>
              <p class="muted small">{t.description}</p>
              <div class="field-row">
                <label
                  >Runs on
                  <select bind:value={job.runsOn}>
                    {#each RUNNERS as r (r)}<option value={r}>{r}</option>{/each}
                  </select>
                </label>
                {#if t.matrixKey}
                  <label
                    >Versions ({t.matrixKey})
                    <input
                      class="mono"
                      placeholder="one version, or several: 20, 22"
                      value={job.versions.join(", ")}
                      oninput={(e) => (job.versions = list(e.currentTarget.value))}
                    />
                  </label>
                {/if}
              </div>
              {#each t.inputs as input (input.key)}
                <label class="full"
                  >{input.label}
                  <input class="mono" bind:value={job.inputs[input.key]} placeholder={input.placeholder} /></label
                >
              {/each}
              {#if model.jobs.length > 1}
                <div class="needs">
                  <span class="muted">Runs after:</span>
                  {#each model.jobs.filter((j) => j !== job) as other (other)}
                    <label class="check compact">
                      <input
                        type="checkbox"
                        checked={job.needs.includes(other.id)}
                        onchange={(e) => toggleNeed(job, other.id, e.currentTarget.checked)}
                      />
                      {other.name}
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
          <div class="add-job">
            <select bind:value={addTemplate}>
              {#each TEMPLATES as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
            </select>
            <button onclick={addJob}><span class="codicon codicon-add"></span>Add job</button>
          </div>
        </div>

        <div class="card">
          <h3>Safety</h3>
          <label class="check">
            <input type="checkbox" bind:checked={model.readOnlyPermissions} />
            Read-only access to the repo (recommended)
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={model.cancelSuperseded} />
            Cancel an older run when a newer push arrives
          </label>
        </div>
      </section>

      <section class="preview">
        <h3>Order</h3>
        <Flow jobs={model.jobs} {problemJobs} />
        {#if problems.length}
          <ul class="problems">
            {#each problems as p, i (i)}
              <li><span class="codicon codicon-warning"></span>{p.message}</li>
            {/each}
          </ul>
        {:else}
          <p class="ok ready">
            <span class="codicon codicon-pass"></span>Ready to save{savedNote ? ` · ${savedNote}` : ""}
          </p>
        {/if}
        <div class="yaml-head">
          <h3>.github/workflows/{model.file}</h3>
          <button class="icon-button" title="Copy YAML" onclick={copyYaml}
            ><span class="codicon codicon-{copied ? 'check' : 'copy'}"></span></button
          >
        </div>
        <pre class="yaml">{yaml}</pre>
      </section>
    </div>
  {/if}
</main>

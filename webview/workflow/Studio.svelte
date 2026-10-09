<script lang="ts">
  import { onMount } from "svelte";
  import type { HostToStudio, WorkflowFile } from "../../src/shared/messages";
  import {
    detectStacks,
    goals,
    validate,
    type Goal,
    type ProjectFacts,
    type WorkflowModel,
  } from "../../src/workflow/model";
  import { warnings } from "../../src/workflow/warnings";
  import { toYaml, type Explanation } from "../../src/workflow/yaml";
  import { send } from "./api";
  import Builder from "./Builder.svelte";
  import Flow from "./Flow.svelte";
  import Start from "./Start.svelte";

  type Mode =
    | { kind: "loading" }
    | { kind: "start" }
    | { kind: "build"; file: string | null }
    | { kind: "explain"; file: string; explanation: Explanation };

  let mode: Mode = $state({ kind: "loading" });
  let model: WorkflowModel | null = $state(null);
  let facts: ProjectFacts | null = $state(null);
  let files: WorkflowFile[] = $state([]);
  let repoName = $state("");
  let error: string | null = $state(null);
  let savedNote: string | null = $state(null);
  /** Set when the open workflow was read from a hand-written file. */
  let importedNote: string | null = $state(null);
  let showYaml = $state(false);
  let copied = $state(false);

  const goalList = $derived(facts ? goals(facts) : []);
  const stacks = $derived(facts ? detectStacks(facts) : []);
  const problems = $derived(model ? validate(model) : []);
  const cautions = $derived(model ? warnings(model).length : 0);
  /** The other workflows in the repo, by name, for "After another workflow". */
  const workflowNames = $derived(
    files
      .filter((f) => f.file !== model?.file && f.summary !== "Couldn't read this file")
      .map((f) => f.summary.split(" · ")[0]),
  );
  const yaml = $derived(model ? toYaml(model).replace(/\n# gitkit-model: .*\n$/, "\n") : "");

  function pick(goal: Goal) {
    model = structuredClone($state.snapshot(goal.model) as WorkflowModel);
    mode = { kind: "build", file: null };
    savedNote = null;
    importedNote = null;
  }

  function save() {
    if (model) send({ type: "save", model: $state.snapshot(model) as WorkflowModel });
  }

  async function copyYaml() {
    await navigator.clipboard?.writeText(yaml);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  onMount(() => {
    const onMessage = (event: MessageEvent<HostToStudio>) => {
      const message = event.data;
      error = null;
      if (message.type === "init") {
        repoName = message.repoName;
        facts = message.facts;
        files = message.files;
        mode = { kind: "start" };
      } else if (message.type === "opened") {
        savedNote = null;
        importedNote = message.imported
          ? `Opened ${message.file} from the file itself. Saving edits only what you change, so its comments and formatting stay.`
          : null;
        if (message.model) {
          model = message.model;
          mode = { kind: "build", file: message.file };
        } else {
          mode = { kind: "explain", file: message.file, explanation: message.explanation };
        }
      } else if (message.type === "saved") {
        files = message.files;
        mode = { kind: "build", file: message.file };
        importedNote = null;
        savedNote = `Saved .github/workflows/${message.file}. Commit and push it to run it.`;
      } else if (message.type === "error") error = message.message;
    };
    window.addEventListener("message", onMessage);
    send({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  });
</script>

<main class="studio">
  <header class="studio-bar">
    {#if mode.kind === "build" || mode.kind === "explain"}
      <button class="back" onclick={() => (mode = { kind: "start" })}>
        <span class="codicon codicon-arrow-left"></span>All workflows
      </button>
    {:else}
      <span class="codicon codicon-github-action accent" aria-hidden="true"></span>
    {/if}
    <b>Workflow Studio</b>
    <span class="muted">{repoName}</span>
    <span class="spacer"></span>

    {#if mode.kind === "build" && model}
      <span class="status" class:ok={!problems.length} class:warn={problems.length > 0} role="status">
        {#if problems.length}
          <span class="codicon codicon-warning"></span>{problems.length} thing{problems.length === 1 ? "" : "s"} to fix
        {:else}
          <span class="codicon codicon-pass"></span>Ready to save{cautions
            ? ` · ${cautions} warning${cautions === 1 ? "" : "s"}`
            : ""}
        {/if}
      </span>
      <button class="yaml-toggle" aria-pressed={showYaml} onclick={() => (showYaml = !showYaml)}>
        <span class="codicon codicon-code"></span>{showYaml ? "Hide" : "Show"} YAML
      </button>
      <label class="file-field">
        <span class="muted">.github/workflows/</span>
        <input class="mono" bind:value={model.file} aria-label="File name" size={Math.max(model.file.length, 6)} />
      </label>
      <button class="primary" disabled={problems.length > 0} onclick={save}>
        <span class="codicon codicon-save"></span>Save
      </button>
    {/if}
  </header>

  {#if error}
    <div class="banner" role="alert">
      <span class="codicon codicon-error"></span>
      <div class="banner-body"><p>{error}</p></div>
      <button class="icon-button" aria-label="Dismiss" onclick={() => (error = null)}
        ><span class="codicon codicon-close"></span></button
      >
    </div>
  {/if}
  {#if savedNote && mode.kind === "build"}
    <p class="saved-note" role="status"><span class="codicon codicon-check"></span>{savedNote}</p>
  {/if}
  {#if importedNote && mode.kind === "build"}
    <p class="saved-note" role="note"><span class="codicon codicon-info"></span>{importedNote}</p>
  {/if}

  {#if mode.kind === "loading"}
    <p class="muted pad">Looking at your project…</p>
  {:else if mode.kind === "start"}
    <Start goals={goalList} {files} onPick={pick} onOpen={(file) => send({ type: "open", file })} />
  {:else if mode.kind === "explain"}
    {@const ex = mode.explanation}
    <section class="explain">
      <h2 class="mono">{mode.file}</h2>
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
      </div>
    </section>
  {:else if model}
    <div class="studio-body" class:with-yaml={showYaml}>
      <div class="studio-main">
        <Builder bind:model {problems} {stacks} {workflowNames} />
      </div>
      {#if showYaml}
        <aside class="yaml-pane" aria-label="Generated YAML">
          <div class="yaml-head">
            <span class="mono">.github/workflows/{model.file}</span>
            <button class="icon-button" aria-label="Copy YAML" onclick={copyYaml}
              ><span class="codicon codicon-{copied ? 'check' : 'copy'}"></span></button
            >
          </div>
          <pre class="yaml">{yaml}</pre>
        </aside>
      {/if}
    </div>
  {/if}
</main>

<script lang="ts">
  import type { WorkflowFile } from "../../src/shared/messages";
  import type { Goal } from "../../src/workflow/model";

  let {
    goals,
    files,
    onPick,
    onOpen,
  }: { goals: Goal[]; files: WorkflowFile[]; onPick: (goal: Goal) => void; onOpen: (file: string) => void } = $props();

  // Recommended goals first, keeping the rest in their natural order.
  const ordered = $derived([...goals].sort((a, b) => Number(b.recommended) - Number(a.recommended)));
</script>

<section class="start">
  <h1>What do you want to automate?</h1>
  <p class="muted lead">Pick a starting point. You can change everything afterwards.</p>

  <div class="goals">
    {#each ordered as goal (goal.id)}
      <button class="goal" class:recommended={goal.recommended} onclick={() => onPick(goal)}>
        <span class="goal-icon codicon codicon-{goal.icon}" aria-hidden="true"></span>
        <span class="goal-text">
          <span class="goal-title">{goal.title}</span>
          <span class="goal-description">{goal.description}</span>
        </span>
        {#if goal.recommended}<span class="badge-recommended">Recommended for this project</span>{/if}
      </button>
    {/each}
  </div>

  {#if files.length}
    <h2>Your workflows</h2>
    <ul class="existing">
      {#each files as f (f.file)}
        <li>
          <button class="existing-file" onclick={() => onOpen(f.file)}>
            <span class="codicon codicon-github-action" aria-hidden="true"></span>
            <span class="existing-text">
              <span class="mono">{f.file}</span>
              <span class="muted">{f.summary}</span>
            </span>
            <span class="pill-soft">{f.byGitKit ? "Editable here" : "Hand-written"}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

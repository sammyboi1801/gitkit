<script lang="ts">
  import { scalar } from "../../src/workflow/options";

  // Name/value rows, for environment variables and similar maps. Rows live here so a half-typed
  // row (no name yet) doesn't disappear; every edit reports the resulting map, or undefined if empty.

  type Value = string | number | boolean;
  let {
    value,
    onchange,
    label,
    hint = "",
    keyPlaceholder = "NAME",
    valuePlaceholder = "value",
    addLabel = "Add a variable",
  }: {
    value: Record<string, unknown> | undefined;
    onchange: (value: Record<string, Value> | undefined) => void;
    label: string;
    hint?: string;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    addLabel?: string;
  } = $props();

  const text = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
  // svelte-ignore state_referenced_locally
  let rows = $state(Object.entries(value ?? {}).map(([key, v]) => ({ key, value: text(v) })));

  function commit() {
    const entries = rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), scalar(r.value)] as const);
    onchange(entries.length ? Object.fromEntries(entries) : undefined);
  }
</script>

<div class="field" role="group" aria-label={label}>
  <span class="field-label">{label}</span>
  {#each rows as row, i (i)}
    <div class="input-row">
      <input
        class="mono"
        aria-label="{label}: name"
        placeholder={keyPlaceholder}
        bind:value={row.key}
        oninput={commit}
      />
      <input
        class="mono"
        aria-label="{label}: value of {row.key || 'the new one'}"
        placeholder={valuePlaceholder}
        bind:value={row.value}
        oninput={commit}
      />
      <button
        class="icon-button"
        aria-label="Remove {row.key || 'this row'}"
        onclick={() => {
          rows.splice(i, 1);
          commit();
        }}><span class="codicon codicon-close"></span></button
      >
    </div>
  {/each}
  <button class="link" onclick={() => rows.push({ key: "", value: "" })}
    ><span class="codicon codicon-add"></span>{addLabel}</button
  >
  {#if hint}<span class="field-hint">{hint}</span>{/if}
</div>

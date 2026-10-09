<script lang="ts">
  import { parseYamlMapping, toYamlText } from "../../src/workflow/options";

  // The escape hatch: a set of keys edited as YAML, applied as soon as it's valid. Anything GitHub
  // Actions supports can be written here, even what the builder has no field for.

  let {
    value,
    onapply,
    label,
    hint = "",
  }: {
    value: unknown;
    onapply: (value: Record<string, unknown> | undefined) => void;
    label: string;
    hint?: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(toYamlText(value));
  let error: string | null = $state(null);

  function input(next: string) {
    text = next;
    const result = parseYamlMapping(next);
    if ("error" in result) {
      error = result.error;
      return;
    }
    error = null;
    onapply(result.value);
  }
</script>

<label class="field yaml-box">
  <span class="field-label">{label}</span>
  <textarea
    class="mono"
    rows={Math.min(14, Math.max(4, text.split("\n").length + 1))}
    spellcheck="false"
    aria-invalid={error !== null}
    value={text}
    oninput={(e) => input(e.currentTarget.value)}></textarea>
  {#if error}
    <span class="field-error" role="alert">Not applied yet: {error}</span>
  {:else if hint}
    <span class="field-hint">{hint}</span>
  {/if}
</label>

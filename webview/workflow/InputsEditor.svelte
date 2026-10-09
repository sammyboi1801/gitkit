<script lang="ts">
  import {
    inputRows,
    newInput,
    splitList,
    withInputs,
    type InputRow,
    type InputType,
  } from "../../src/workflow/triggers";

  // Inputs people fill in when they start the workflow (the Run button), or that a calling workflow
  // passes in (a reusable workflow). Each is a small form: name, kind, default, and so on.

  let {
    inputs,
    onchange,
    kinds,
    what,
  }: {
    inputs: unknown;
    onchange: (inputs: Record<string, unknown> | undefined) => void;
    kinds: InputType[];
    /** "Run button" or "calling workflow", for the hints. */
    what: string;
  } = $props();

  const KIND_LABELS: Record<InputType, string> = {
    string: "Text",
    choice: "Choice from a list",
    boolean: "Yes or no",
    number: "Number",
    environment: "Environment",
  };

  // svelte-ignore state_referenced_locally
  let rows: InputRow[] = $state(inputRows(inputs));
  const commit = () => onchange(withInputs(rows));
</script>

<div class="field inputs-editor" role="group" aria-label="Inputs">
  <span class="field-label">Inputs<span class="optional"> optional</span></span>
  {#each rows as row, i (i)}
    <div class="input-card">
      <div class="input-card-row">
        <input class="mono" aria-label="Input name" placeholder="environment" bind:value={row.name} oninput={commit} />
        <select
          aria-label="Kind of {row.name || 'input'}"
          value={row.type}
          onchange={(e) => {
            row.type = e.currentTarget.value as InputType;
            if (row.type === "choice" && !row.options.length) row.options = ["staging", "production"];
            if (row.type === "boolean" && row.default !== "true") row.default = "";
            commit();
          }}
        >
          {#each kinds as kind (kind)}<option value={kind}>{KIND_LABELS[kind]}</option>{/each}
        </select>
        <label class="inline-toggle">
          <input type="checkbox" bind:checked={row.required} onchange={commit} />Required
        </label>
        <button
          class="icon-button"
          aria-label="Remove input {row.name}"
          onclick={() => {
            rows.splice(i, 1);
            commit();
          }}><span class="codicon codicon-close"></span></button
        >
      </div>
      <input
        aria-label="Description of {row.name || 'the input'}"
        placeholder="What it's for, shown next to the field"
        bind:value={row.description}
        oninput={commit}
      />
      {#if row.type === "choice"}
        <input
          class="mono"
          aria-label="Options of {row.name || 'the input'}"
          placeholder="staging, production"
          value={row.options.join(", ")}
          oninput={(e) => {
            row.options = splitList(e.currentTarget.value);
            commit();
          }}
        />
      {/if}
      <label class="input-default">
        <span class="field-hint">Default</span>
        {#if row.type === "boolean"}
          <select aria-label="Default of {row.name || 'the input'}" bind:value={row.default} onchange={commit}>
            <option value="">No</option>
            <option value="true">Yes</option>
          </select>
        {:else if row.type === "choice"}
          <select aria-label="Default of {row.name || 'the input'}" bind:value={row.default} onchange={commit}>
            <option value="">none</option>
            {#each row.options as option (option)}<option value={option}>{option}</option>{/each}
          </select>
        {:else}
          <input
            class="mono"
            aria-label="Default of {row.name || 'the input'}"
            placeholder="none"
            type={row.type === "number" ? "number" : "text"}
            bind:value={row.default}
            oninput={commit}
          />
        {/if}
      </label>
    </div>
  {/each}
  <button
    class="link"
    onclick={() => {
      rows.push(newInput());
    }}><span class="codicon codicon-add"></span>Add an input</button
  >
  <span class="field-hint">{"Read them in steps as ${{ inputs.NAME }}."} Filled in by the {what}.</span>
</div>

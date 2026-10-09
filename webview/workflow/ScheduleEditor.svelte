<script lang="ts">
  import { TIMEZONES } from "../../src/workflow/events";
  import {
    WEEKDAYS,
    cronFor,
    describeSchedule,
    scheduleSpec,
    type Frequency,
    type ScheduleSpec,
  } from "../../src/workflow/model";
  import type { ScheduleRow } from "../../src/workflow/triggers";

  // One schedule: picked from lists (every day at 06:00, every Monday…), or any cron, in UTC or a
  // timezone of your choice.

  let {
    row,
    onchange,
    label = "Schedule",
  }: { row: ScheduleRow; onchange: (row: ScheduleRow) => void; label?: string } = $props();

  const FREQUENCIES: { value: Frequency; label: string }[] = [
    { value: "hourly", label: "Every hour" },
    { value: "daily", label: "Every day" },
    { value: "weekly", label: "Every week" },
    { value: "monthly", label: "Every month" },
  ];
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  const DAYS = Array.from({ length: 28 }, (_, d) => d + 1);
  const DEFAULT_SPEC: ScheduleSpec = { frequency: "daily", minute: 0, hour: 6, weekday: 1, day: 1 };
  const pad = (n: number) => String(n).padStart(2, "0");
  const ordinal = (d: number) =>
    `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
  /** Every five minutes, plus whatever odd minute the cron already uses. */
  const minutes = (current: number) =>
    [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), current])].sort((a, b) => a - b);

  const uid = $props.id();
  /** The person chose "Custom", so the cron field shows even for a simple cron. */
  let custom = $state(false);
  const spec = $derived(custom ? null : scheduleSpec(row.cron));
  const zone = $derived(row.timezone ?? "UTC");
  const zoneLabel = $derived(zone === "UTC" ? "UTC" : zone.split("/").pop()!.replace(/_/g, " "));

  const set = (patch: Partial<ScheduleSpec>) =>
    onchange({ ...row, cron: cronFor({ ...(scheduleSpec(row.cron) ?? DEFAULT_SPEC), ...patch }) });
  function setFrequency(value: string) {
    custom = value === "custom";
    if (!custom) set({ frequency: value as Frequency });
  }
</script>

<div class="schedule-editor" role="group" aria-label={label}>
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
        <select value={spec.weekday} onchange={(e) => set({ weekday: Number(e.currentTarget.value) })}>
          {#each WEEKDAYS as day, i (day)}<option value={i}>{day}</option>{/each}
        </select>
      </label>
    {:else if spec?.frequency === "monthly"}
      <label class="field">
        <span class="field-label">On the</span>
        <select value={spec.day} onchange={(e) => set({ day: Number(e.currentTarget.value) })}>
          {#each DAYS as d (d)}<option value={d}>{ordinal(d)}</option>{/each}
        </select>
      </label>
    {/if}
    {#if spec && spec.frequency !== "hourly"}
      <div class="field">
        <span class="field-label" id="{uid}-time">At ({zoneLabel})</span>
        <span class="time" role="group" aria-labelledby="{uid}-time">
          <select aria-label="Hour" value={spec.hour} onchange={(e) => set({ hour: Number(e.currentTarget.value) })}>
            {#each HOURS as h (h)}<option value={h}>{pad(h)}</option>{/each}
          </select>
          :
          <select
            aria-label="Minute"
            value={spec.minute}
            onchange={(e) => set({ minute: Number(e.currentTarget.value) })}
          >
            {#each minutes(spec.minute) as m (m)}<option value={m}>{pad(m)}</option>{/each}
          </select>
        </span>
      </div>
    {:else if spec}
      <label class="field">
        <span class="field-label">At minute</span>
        <select value={spec.minute} onchange={(e) => set({ minute: Number(e.currentTarget.value) })}>
          {#each minutes(spec.minute) as m (m)}<option value={m}>:{pad(m)}</option>{/each}
        </select>
      </label>
    {/if}
    <label class="field">
      <span class="field-label">Timezone</span>
      <select
        value={zone}
        onchange={(e) =>
          onchange({ cron: row.cron, ...(e.currentTarget.value === "UTC" ? {} : { timezone: e.currentTarget.value }) })}
      >
        {#each TIMEZONES.includes(zone) ? TIMEZONES : [zone, ...TIMEZONES] as z (z)}<option value={z}
            >{z.replace(/_/g, " ")}</option
          >{/each}
      </select>
    </label>
  </div>
  <!-- Always shown: the cron is what GitHub reads, and seeing it makes custom ones easy to write. -->
  <label class="field">
    <span class="field-label">Cron expression</span>
    <input
      class="mono short"
      spellcheck="false"
      value={row.cron}
      oninput={(e) => onchange({ ...row, cron: e.currentTarget.value })}
    />
    <span class="field-hint"
      >{describeSchedule(row.cron).replace(/ UTC/, zone === "UTC" ? " UTC" : ` ${zoneLabel} time`)}. Fields: minute hour
      day-of-month month day-of-week; * means every.</span
    >
  </label>
</div>

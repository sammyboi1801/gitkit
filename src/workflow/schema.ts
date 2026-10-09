import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import schema from "./github-workflow.schema.json";

// Checks a workflow against GitHub's official schema (from SchemaStore, the one editors use for
// .github/workflows files), so anything typed into the YAML boxes is checked too. Fetched from
// https://json.schemastore.org/github-workflow.json in October 2026.

let validator: ValidateFunction | undefined;

function validate(): ValidateFunction {
  // Compiled once, on first use: it's the slowest part, and most sessions never save a workflow.
  validator ??= new Ajv({ allErrors: true, strict: false }).compile(schema);
  return validator;
}

/** Where in the workflow, for people: "jobs › test › steps › 2" (steps counted from 1). */
function place(pointer: string): string {
  const parts = pointer
    .split("/")
    .slice(1)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((p, i, all) => (/^\d+$/.test(p) && all[i - 1] === "steps" ? String(Number(p) + 1) : p));
  return parts.length ? parts.join(" › ") : "the workflow";
}

function say(error: ErrorObject): string {
  const where = place(error.instancePath);
  const p = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "additionalProperties":
      return `${where}: GitHub doesn't know "${p.additionalProperty}"`;
    case "required":
      return `${where}: needs "${p.missingProperty}"`;
    case "type":
      return `${where}: should be ${p.type === "array" ? "a list" : p.type === "object" ? "a set of keys" : `a ${p.type}`}`;
    case "enum":
      return `${where}: should be one of ${(p.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(", ")}`;
    default:
      return `${where}: ${error.message ?? "isn't valid"}`;
  }
}

/**
 * What GitHub would reject in this workflow, in plain words; empty when it's valid. Alternatives
 * (anyOf/oneOf) make the validator list every way each option failed, so only the most specific
 * problems are kept: the deepest location each error points at.
 */
export function schemaProblems(workflow: unknown, max = 5): string[] {
  const check = validate();
  if (check(workflow)) return [];
  const errors = (check.errors ?? []).filter(
    (e) => !["anyOf", "oneOf", "if", "then", "else", "not"].includes(e.keyword),
  );
  const deepest = errors.filter(
    (e) => !errors.some((other) => other !== e && other.instancePath.startsWith(`${e.instancePath}/`)),
  );
  const messages = [...new Set((deepest.length ? deepest : errors).map(say))];
  return messages.length ? messages.slice(0, max) : ["It doesn't match GitHub's workflow schema."];
}

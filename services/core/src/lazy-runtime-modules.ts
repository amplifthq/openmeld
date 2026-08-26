/**
 * Loads request-only runtime modules from the Worker bundle root.
 *
 * Wrangler keeps these imports external and uploads the generated modules next
 * to the bundled `index.js`. Keep every specifier in this root-level owner so
 * the uploaded module graph and runtime resolution use the same base path.
 */
export function loadRoutineScheduleRuntime() {
  return import("./generated-runtime/routine-schedule.mjs");
}

export function loadSlackMarkdownRuntime() {
  return import("./generated-runtime/slackify-markdown.mjs");
}

export function loadYamlRuntime() {
  return import("./generated-runtime/yaml.mjs");
}

export function loadZepRuntime() {
  return import("./generated-runtime/zep-cloud.mjs");
}

#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { inspectTrustedCandidateEntrypoints } from "./verify-trusted-candidate-entrypoints.mjs";

export const HOSTED_CONTROL_REFUSE_DISPOSITION =
  "protected-local-validation-required";
export const HOSTED_RUN_DISPOSITION = "run";
export const FINAL_CANDIDATE_RUNNER_CHECK_NAME = "Final Candidate Runner";
export const HOSTED_CONTROL_REFUSE_TITLE =
  "Protected local validation required";
export const HOSTED_CONTROL_REFUSE_SUMMARY = [
  "This pull request changes Final Candidate control. Hosted validation was skipped because a candidate cannot certify its own control changes.",
  "",
  "Run the protected local bootstrap for this exact head before merging. [Read the Final Candidate fallback documentation](https://github.com/amplifthq/openmeld/blob/main/developing/engineering/agent-native-delivery.md#actions-unavailable-fallback).",
].join("\n");

export function resolveHostedFinalCandidateDisposition(input) {
  const inspection = inspectTrustedCandidateEntrypoints(input);
  if (inspection.driftedPaths.length === 0) {
    return {
      checkedPaths: inspection.checkedPaths,
      disposition: HOSTED_RUN_DISPOSITION,
      driftedPaths: [],
      runCandidate: true,
    };
  }
  return {
    checkedPaths: inspection.checkedPaths,
    conclusion: "skipped",
    disposition: HOSTED_CONTROL_REFUSE_DISPOSITION,
    driftedPaths: inspection.driftedPaths,
    runCandidate: false,
    summary: HOSTED_CONTROL_REFUSE_SUMMARY,
    title: HOSTED_CONTROL_REFUSE_TITLE,
  };
}

function run() {
  const options = parseOptions(process.argv.slice(2));
  const result = resolveHostedFinalCandidateDisposition(options);
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error(
      "Hosted Final Candidate classification requires GITHUB_OUTPUT."
    );
  }
  appendFileSync(
    outputPath,
    [
      `disposition=${result.disposition}`,
      `run_candidate=${String(result.runCandidate)}`,
      "",
    ].join("\n"),
    "utf8"
  );
  const summary = renderWorkflowSummary(result);
  process.stdout.write(`${summary}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  }
}

function renderWorkflowSummary(result) {
  if (result.runCandidate) {
    return [
      "## Hosted Final Candidate eligibility",
      "",
      "Hosted validation can run with trusted current-main control.",
    ].join("\n");
  }
  return [
    `## ${HOSTED_CONTROL_REFUSE_TITLE}`,
    "",
    HOSTED_CONTROL_REFUSE_SUMMARY,
    "",
    "Changed controls:",
    ...result.driftedPaths.map((relativePath) => `- \`${relativePath}\``),
  ].join("\n");
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!(option?.startsWith("--") && value)) {
      throw new Error(
        "Hosted Final Candidate classification requires trusted and candidate roots."
      );
    }
    const key = {
      "--candidate-root": "candidateRoot",
      "--trusted-root": "trustedRoot",
    }[option];
    if (!key) {
      throw new Error(`Unknown hosted disposition option: ${option}`);
    }
    options[key] = value;
  }
  if (!(options.candidateRoot && options.trustedRoot)) {
    throw new Error(
      "Hosted Final Candidate classification requires trusted and candidate roots."
    );
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { formatCommand } from "./final-candidate-policy.mjs";

export function printPlan(plan, dirtyPaths) {
  process.stdout.write(
    [
      "Final Candidate plan",
      `Head: ${plan.headSha}`,
      `Base: ${plan.baseSha}`,
      `Tree: ${plan.treeSha}`,
      `Branch: ${plan.branchName}`,
      `Confidence: ${plan.confidence}`,
      `Risk: ${plan.riskTags.join(", ") || "none"}`,
      "Changed paths:",
      ...(plan.changedPaths.length > 0
        ? plan.changedPaths.map((candidatePath) => `- ${candidatePath}`)
        : ["- none"]),
      "Selected checks:",
      ...plan.selectedChecks.map(
        (selectedCheck) =>
          `- ${selectedCheck.id}: ${formatCommand(selectedCheck.command)}\n  Why: ${selectedCheck.reason}`
      ),
      "Skipped checks:",
      ...plan.skippedChecks.map(
        (skippedCheck) => `- ${skippedCheck.id}: ${skippedCheck.reason}`
      ),
      ...(dirtyPaths.length > 0
        ? [
            "Uncommitted paths (a run will fail until these are committed or removed):",
            ...dirtyPaths.map((candidatePath) => `- ${candidatePath}`),
          ]
        : []),
      "",
    ].join("\n")
  );
}

export function renderEvidenceSummary(evidence, evidencePath) {
  const durationMs = Math.max(
    0,
    Date.parse(evidence.finishedAt) - Date.parse(evidence.startedAt)
  );
  return [
    "## OpenMeld Final Candidate Evidence",
    "",
    `- Conclusion: **${evidence.conclusion}**`,
    `- Mode: \`${evidence.mode}\``,
    `- Head: \`${evidence.headSha ?? "unresolved"}\``,
    `- Base: \`${evidence.baseSha ?? "unresolved"}\``,
    `- Tree: \`${evidence.treeSha ?? "unresolved"}\``,
    `- Risk: ${evidence.riskTags?.join(", ") || "unresolved"}`,
    `- Duration: ${formatDuration(durationMs)}`,
    `- Evidence file: \`${evidencePath}\``,
    ...(evidence.pullRequestUrl
      ? [`- Pull request: ${evidence.pullRequestUrl}`]
      : []),
    ...(evidence.error ? [`- Error: ${evidence.error}`] : []),
    "",
    "### Checks",
    "",
    ...(evidence.results?.length > 0
      ? evidence.results.map(
          (result) =>
            `- **${result.status}** \`${formatCommand(result.command)}\` (${formatDuration(result.durationMs)}) — ${result.reason}`
        )
      : ["- No check completed."]),
    "",
    "### Skipped",
    "",
    ...(evidence.skippedChecks?.length > 0
      ? evidence.skippedChecks.map(
          (skippedCheck) => `- \`${skippedCheck.id}\` — ${skippedCheck.reason}`
        )
      : ["- None recorded."]),
  ].join("\n");
}

export function writeEvidence(evidencePath, evidence) {
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export function appendWorkflowSummary(summary) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${summary}\n`, "utf8");
  }
}

export function resolveEvidencePath(requestedPath, headSha) {
  if (requestedPath) {
    return path.resolve(requestedPath);
  }
  return path.join(
    "dev-tmp",
    `final-candidate-${shortSha(headSha ?? "unresolved")}.json`
  );
}

export function resolveTargetUrl(mode, repository, pullRequestUrl) {
  if (mode === "remote" && process.env.GITHUB_RUN_ID) {
    return `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  }
  return pullRequestUrl;
}

export function summarizeRisk(riskTags) {
  return (riskTags?.join("+") || "candidate").slice(0, 72);
}

export function shortSha(value) {
  return String(value ?? "unresolved").slice(0, 12);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "unknown";
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}

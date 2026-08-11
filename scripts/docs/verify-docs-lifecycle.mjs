#!/usr/bin/env node
// Enforces the documentation contract owned by developing/README.md.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("../..", import.meta.url).pathname;
const docsRoot = join(repoRoot, "developing");
const strict = process.argv.includes("--strict");

const HEAD_LINES = 40;
const AGENT_CONTEXT_FIELDS = [
  "Purpose",
  "Read this when",
  "Update this when",
  "Do not use this for",
  "Source of truth",
];
const STATUS_RE = /^(?:\*\*)?Status:(?:\*\*)?\s*/im;
const REMOVAL_RE =
  /\b(?:[Rr]emove|[Dd]elete)\b[^.]{0,200}\b(?:when|after|once)\b/;
const EXPIRY_RE =
  /\b(?:SHIPPED|SUPERSEDED|(?<!NOT )(?<!NOT-)IMPLEMENTED|CLOSED|DONE|RELEASED|released|deployed)\b/;

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walk(fullPath));
    } else if (name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

export function isLifecycleDocument(relativePath) {
  // developing/README.md owns this structural classification contract.
  return (
    relativePath.includes("/review/") ||
    relativePath.endsWith("-design.md") ||
    relativePath.endsWith("-handoff.md") ||
    relativePath.endsWith("-plan.md")
  );
}

export function analyzeDocument(relativePath, text) {
  const violations = [];
  const deletionCandidates = [];
  const head = text.split("\n").slice(0, HEAD_LINES).join("\n");
  const headLines = head.split("\n");
  const lifecycle = isLifecycleDocument(relativePath);

  if (
    !headLines[0]?.startsWith("# ") ||
    headLines[1] !== "" ||
    headLines[2] !== "## Agent Context"
  ) {
    violations.push(
      `${relativePath}: document must start with its title followed immediately by "## Agent Context"`
    );
  }
  for (const field of AGENT_CONTEXT_FIELDS) {
    if (!headLines.some((line) => line.startsWith(`- ${field}:`))) {
      violations.push(
        `${relativePath}: Agent Context is missing "- ${field}:"`
      );
    }
  }

  const statusMatch = head.match(STATUS_RE);
  if (lifecycle) {
    if (!statusMatch) {
      violations.push(
        `${relativePath}: lifecycle document has no Status: line in the first ${HEAD_LINES} lines`
      );
    }
    if (!REMOVAL_RE.test(text)) {
      violations.push(
        `${relativePath}: lifecycle document has no explicit removal condition (Remove/Delete ... when/after/once ...)`
      );
    }
    if (statusMatch) {
      const statusLineStart = head.indexOf(statusMatch[0]);
      const statusBlock = head.slice(statusLineStart, statusLineStart + 400);
      if (EXPIRY_RE.test(statusBlock)) {
        deletionCandidates.push(
          `${relativePath}: Status suggests the work is done — verify the removal condition and delete when it holds`
        );
      }
    }
  } else if (statusMatch) {
    violations.push(
      `${relativePath}: owner document must not carry a lifecycle Status: line`
    );
  }

  return { deletionCandidates, violations };
}

export function verifyDocuments(root = docsRoot) {
  const violations = [];
  const deletionCandidates = [];
  for (const file of walk(root)) {
    const relativePath = relative(repoRoot, file);
    const result = analyzeDocument(relativePath, readFileSync(file, "utf8"));
    violations.push(...result.violations);
    deletionCandidates.push(...result.deletionCandidates);
  }
  return { deletionCandidates, violations };
}

function run() {
  const { deletionCandidates, violations } = verifyDocuments();
  if (violations.length === 0) {
    console.log("verify:docs — lifecycle checks passed for developing/");
  } else {
    console.log(`verify:docs — ${violations.length} violation(s):`);
    for (const violation of violations) {
      console.log(`  - ${violation}`);
    }
  }

  if (deletionCandidates.length > 0) {
    console.log(
      `\nverify:docs — ${deletionCandidates.length} deletion candidate(s) (informational):`
    );
    for (const candidate of deletionCandidates) {
      console.log(`  - ${candidate}`);
    }
  }

  if (strict && violations.length > 0) {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  run();
}

#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const DECISION_MATRIX_BLOCK_RE =
  /```json\s+decision-matrix\s*\n([\s\S]*?)\n```/m;

const PHASE_ALLOWLIST = new Set([
  "control-plane",
  "data-plane",
  "ledger-recovery",
  "adapter-dispatch",
  "service-lifecycle",
  "service-liveness",
]);

const REQUIRED_BASE_FIELDS = ["id", "decision", "task", "checkCommand"];

const OPTIONAL_REQUIRED_FIELDS = [
  {
    field: "owner",
    flagKey: "requireOwner",
    flagName: "--require-owner",
  },
  {
    field: "scope",
    flagKey: "requireScope",
    flagName: "--require-scope",
  },
  {
    field: "evidence",
    flagKey: "requireEvidence",
    flagName: "--require-evidence",
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.matrixPath) {
    fail("missing --matrix <path>");
  }

  const fullPath = path.resolve(process.cwd(), args.matrixPath);
  const raw = await readFile(fullPath, "utf8");
  const rows = parseMatrixRows(raw);
  validateRows(rows, args.flags);

  process.stdout.write(
    `decision matrix verified: ${rows.length} rows (${path.relative(process.cwd(), fullPath)})\n`
  );
}

function parseArgs(argv) {
  let matrixPath = "";
  const flags = {
    requireOwner: false,
    requireScope: false,
    requireEvidence: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--matrix") {
      matrixPath = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (token === "--require-owner") {
      flags.requireOwner = true;
      continue;
    }
    if (token === "--require-scope") {
      flags.requireScope = true;
      continue;
    }
    if (token === "--require-evidence") {
      flags.requireEvidence = true;
      continue;
    }
    fail(`unknown argument: ${token}`);
  }

  return { matrixPath, flags };
}

function parseMatrixRows(raw) {
  const match = raw.match(DECISION_MATRIX_BLOCK_RE);
  if (!match?.[1]) {
    fail("missing ```json decision-matrix``` block");
  }

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`invalid JSON in decision-matrix block: ${reason}`);
  }

  if (!Array.isArray(parsed)) {
    fail("decision-matrix block must be an array");
  }
  if (parsed.length === 0) {
    fail("decision-matrix block cannot be empty");
  }

  return parsed;
}

function validateRows(rows, flags) {
  const errors = [];
  const seenIds = new Set();

  for (const [index, row] of rows.entries()) {
    const rowLabel = `row ${index + 1}`;
    if (!isPlainObject(row)) {
      errors.push(`${rowLabel}: must be an object`);
      continue;
    }

    errors.push(...validateRow(row, rowLabel, flags, seenIds));
  }

  if (errors.length > 0) {
    fail(errors.join("\n"));
  }
}

function validateRow(row, rowLabel, flags, seenIds) {
  const errors = [];
  errors.push(...validateRequiredFields(row, rowLabel));
  errors.push(...validateIdAndPhase(row, rowLabel, seenIds));
  errors.push(...validateOptionalRequiredFlags(row, rowLabel, flags));
  return errors;
}

function validateRequiredFields(row, rowLabel) {
  const errors = [];
  for (const field of REQUIRED_BASE_FIELDS) {
    const value = getNonEmptyString(row, field);
    if (!value) {
      errors.push(`${rowLabel}: field "${field}" must be a non-empty string`);
    }
  }
  return errors;
}

function validateIdAndPhase(row, rowLabel, seenIds) {
  const errors = [];

  const id = getNonEmptyString(row, "id");
  if (id) {
    if (seenIds.has(id)) {
      errors.push(`${rowLabel}: duplicate id "${id}"`);
    } else {
      seenIds.add(id);
    }
  }

  const phase = getNonEmptyString(row, "phase");
  if (!phase) {
    errors.push(`${rowLabel}: field "phase" must be a non-empty string`);
  }

  if (phase && !PHASE_ALLOWLIST.has(phase)) {
    errors.push(`${rowLabel}: invalid phase "${phase}"`);
  }

  return errors;
}

function validateOptionalRequiredFlags(row, rowLabel, flags) {
  const errors = [];
  for (const { field, flagKey, flagName } of OPTIONAL_REQUIRED_FIELDS) {
    if (!flags[flagKey]) {
      continue;
    }

    const value = getNonEmptyString(row, field);
    if (!value) {
      errors.push(
        `${rowLabel}: field "${field}" must be a non-empty string when ${flagName} is set`
      );
    }
  }
  return errors;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getNonEmptyString(row, field) {
  const value = row[field];
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  fail(`verify-decision-matrix failed: ${reason}`);
});

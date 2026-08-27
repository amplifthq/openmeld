#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";

const STAGING_ORIGIN = "https://staging.openmeld.ai";
const STAGING_SETUP_URL = `${STAGING_ORIGIN}/setup?dist=binary&lane=canary`;
const STAGING_MANIFEST_URL = `${STAGING_ORIGIN}/cli/manifest.json`;
const SETUP_COMMAND_ERROR =
  "Use the official Staging Canary binary setup command copied from OpenMeld Staging.";
const SAFE_UNQUOTED_SHELL_WORD = /^[A-Za-z0-9_./:@%+=,?&-]+$/u;
const TOKEN_VALUE_PATTERN = /^[A-Za-z0-9_./:@%+=,-]{1,4096}$/u;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[staging-computer-smoke] ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

export function parseStagingComputerSmokeArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 1 && args[0] === "plan") {
    return { command: "plan" };
  }
  if (args[0] !== "run") {
    throw new Error(
      "Staging Computer smoke only accepts plan or run --setup-command-file <path>."
    );
  }
  if (args.length !== 3 || args[1] !== "--setup-command-file") {
    throw new Error(
      "Staging Computer smoke run requires --setup-command-file <path> and only accepts that input."
    );
  }
  const setupCommandFile = String(args[2] ?? "").trim();
  if (!setupCommandFile) {
    throw new Error(
      "Staging Computer smoke run requires --setup-command-file <path>."
    );
  }
  return { command: "run", setupCommandFile };
}

export function parseStagingWebSetupCommand(command) {
  try {
    const normalized = String(command).trim();
    if (normalized.includes("\n") || normalized.includes("\r")) {
      throw new Error("Setup command must be one line.");
    }
    const match =
      /^curl -fsSL (('[^']*')|([^\s|]+)) \| sh -s -- (.+)$/u.exec(
        normalized
      );
    if (!match) {
      throw new Error("Setup command shape is not recognized.");
    }

    const setupUrl = decodeShellWord(match[1]);
    assertOfficialStagingSetupUrl(setupUrl);
    const setupArgs = parseShellWords(match[4]);
    validateSetupArgs(setupArgs);
    return { setupArgs, setupUrl };
  } catch (error) {
    throw new Error(SETUP_COMMAND_ERROR, { cause: error });
  }
}

export function buildStagingSmokeSetupArgs(parsedCommand) {
  const values = readSetupArgumentValues(parsedCommand.setupArgs);
  return [
    "setup",
    "--start-session",
    values.startSession,
    "--local-agents",
    "none",
    "--ott",
    values.ott,
    "--view",
    "agent",
  ];
}

export function redactStagingSetupCommand(command) {
  const parsed = parseStagingWebSetupCommand(command);
  const redactedArgs = [...parsed.setupArgs];
  for (const flag of ["--start-session", "--ott"]) {
    const index = redactedArgs.indexOf(flag);
    redactedArgs[index + 1] = "[redacted]";
  }
  return `curl -fsSL '${parsed.setupUrl}' | sh -s -- ${redactedArgs.join(" ")}`;
}

export function buildStagingComputerSmokePlan() {
  return [
    {
      label: "Verify the Staging CLI channel",
      target: STAGING_MANIFEST_URL,
    },
    {
      label: "Connect an isolated Canary Computer",
      target: "~/.openmeld-canary",
    },
    {
      label: "Publish a newer Staging CLI",
      target: STAGING_MANIFEST_URL,
    },
    {
      label: "Start one automatic update",
      target: "OpenMeld Service Canary",
    },
    {
      label: "Coalesce a manual Update request",
      target: "The same Staging update operation",
    },
    {
      label: "Verify Service recovery and one final version",
      target: STAGING_ORIGIN,
    },
    {
      label: "Restore the previous Canary state",
      target: "~/.openmeld-canary",
    },
  ];
}

async function runCli(argv) {
  const options = parseStagingComputerSmokeArgs(argv);
  if (options.command === "plan") {
    printPlan();
    return;
  }
  throw new Error(
    `Live Staging Computer smoke is not available yet for ${options.setupCommandFile}.`
  );
}

function printPlan() {
  process.stdout.write("OpenMeld Staging Computer update smoke:\n");
  for (const step of buildStagingComputerSmokePlan()) {
    process.stdout.write(`- ${step.label}\n`);
  }
}

function assertOfficialStagingSetupUrl(value) {
  const url = new URL(value);
  const keys = [...url.searchParams.keys()].sort();
  if (
    url.origin !== STAGING_ORIGIN ||
    url.pathname !== "/setup" ||
    url.username ||
    url.password ||
    url.hash ||
    keys.length !== 2 ||
    keys[0] !== "dist" ||
    keys[1] !== "lane" ||
    url.searchParams.get("dist") !== "binary" ||
    url.searchParams.get("lane") !== "canary"
  ) {
    throw new Error("Setup URL is outside the Staging Canary binary lane.");
  }
}

function decodeShellWord(word) {
  if (word.startsWith("'") && word.endsWith("'")) {
    return word.slice(1, -1);
  }
  if (!SAFE_UNQUOTED_SHELL_WORD.test(word)) {
    throw new Error("Setup URL contains unsupported shell syntax.");
  }
  return word;
}

function parseShellWords(value) {
  if (!value || /[;$`()<>\\]/u.test(value)) {
    throw new Error("Setup arguments contain unsupported shell syntax.");
  }
  const words = value.split(/\s+/u);
  if (words.some((word) => !SAFE_UNQUOTED_SHELL_WORD.test(word))) {
    throw new Error("Setup arguments must be plain Web-generated values.");
  }
  return words;
}

function validateSetupArgs(args) {
  if (args[0] !== "setup") {
    throw new Error("Setup arguments must start with setup.");
  }
  const values = readSetupArgumentValues(args);
  if (!(values.startSession && values.ott && values.view)) {
    throw new Error("Setup handoff credentials are missing.");
  }
}

function readSetupArgumentValues(args) {
  const values = {
    localAgents: null,
    ott: null,
    startSession: null,
    view: null,
  };
  const seen = new Set();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !(flag in {
        "--local-agents": true,
        "--ott": true,
        "--start-session": true,
        "--view": true,
      }) ||
      seen.has(flag) ||
      !value ||
      !TOKEN_VALUE_PATTERN.test(value)
    ) {
      throw new Error("Setup arguments are incomplete or unsupported.");
    }
    seen.add(flag);
    if (flag === "--local-agents") {
      if (value !== "all" && value !== "none") {
        throw new Error("Local Agent selection must be all or none.");
      }
      values.localAgents = value;
    } else if (flag === "--ott") {
      values.ott = value;
    } else if (flag === "--start-session") {
      values.startSession = value;
    } else if (flag === "--view") {
      if (value !== "agent" && value !== "human") {
        throw new Error("Setup view must be human or agent.");
      }
      values.view = value;
    }
  }
  if (args.length % 2 === 0) {
    throw new Error("Setup arguments are incomplete.");
  }
  return values;
}

export const STAGING_COMPUTER_SMOKE_SETUP_URL = STAGING_SETUP_URL;

export const STAGING_ORIGIN = "https://staging.openmeld.ai";
export const STAGING_AUTH_URL = "https://auth.staging.openmeld.ai";
export const STAGING_GATEWAY_URL = "https://gateway.staging.openmeld.ai";
export const STAGING_MANIFEST_URL = `${STAGING_ORIGIN}/cli/manifest.json`;
export const STAGING_COMPUTER_SMOKE_SETUP_URL = `${STAGING_ORIGIN}/setup?dist=binary&lane=canary`;

const SETUP_COMMAND_ERROR =
  "Use the official Staging Canary binary setup command copied from OpenMeld Staging.";
const SAFE_UNQUOTED_SHELL_WORD = /^[A-Za-z0-9_./:@%+=,?&-]+$/u;
const TOKEN_VALUE_PATTERN = /^[A-Za-z0-9_./:@%+=,-]{1,4096}$/u;
const SETUP_PIPELINE_PATTERN =
  /^curl -fsSL (('[^']*')|([^\s|]+)) \| sh -s -- (.+)$/u;
const UNSAFE_SHELL_SYNTAX_PATTERN = /[;$`()<>\\]/u;
const SHELL_WORD_SEPARATOR_PATTERN = /\s+/u;

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
    const match = SETUP_PIPELINE_PATTERN.exec(normalized);
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
  const authArgs = values.deviceCode
    ? ["--device-code", values.deviceCode]
    : ["--ott", values.ott];
  return [
    "setup",
    "--start-session",
    values.startSession,
    ...authArgs,
    "--view",
    "agent",
  ];
}

export function redactStagingSetupCommand(command) {
  const parsed = parseStagingWebSetupCommand(command);
  const redactedArgs = [...parsed.setupArgs];
  for (const flag of ["--start-session", "--device-code", "--ott"]) {
    const index = redactedArgs.indexOf(flag);
    if (index >= 0) {
      redactedArgs[index + 1] = "[redacted]";
    }
  }
  return `curl -fsSL '${parsed.setupUrl}' | sh -s -- ${redactedArgs.join(" ")}`;
}

export function readStagingSetupSensitiveValues(args) {
  const values = readSetupArgumentValues(args);
  return [values.startSession, values.deviceCode, values.ott].filter(Boolean);
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

export function assertCoalescedStagingUpdate(input) {
  const automaticOperationId = input.automaticOperation?.operationId;
  const manualOperationId = input.manualResult?.operation?.operationId;
  if (
    !automaticOperationId ||
    input.automaticOperation.requestSource !== "automatic" ||
    input.manualResult?.status !== "already_running" ||
    manualOperationId !== automaticOperationId
  ) {
    throw new Error(
      "Automatic and manual Update did not use the same background operation."
    );
  }
  return automaticOperationId;
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
  if (!value || UNSAFE_SHELL_SYNTAX_PATTERN.test(value)) {
    throw new Error("Setup arguments contain unsupported shell syntax.");
  }
  const words = value.split(SHELL_WORD_SEPARATOR_PATTERN);
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
  const authCredentialCount =
    Number(Boolean(values.deviceCode)) + Number(Boolean(values.ott));
  if (!(values.startSession && values.view) || authCredentialCount !== 1) {
    throw new Error("Setup handoff credentials are missing.");
  }
}

function readSetupArgumentValues(args) {
  const values = {
    deviceCode: null,
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
      !(
        flag in
        {
          "--device-code": true,
          "--local-agents": true,
          "--ott": true,
          "--start-session": true,
          "--view": true,
        }
      ) ||
      seen.has(flag) ||
      !value ||
      !TOKEN_VALUE_PATTERN.test(value)
    ) {
      throw new Error("Setup arguments are incomplete or unsupported.");
    }
    seen.add(flag);
    assignSetupArgument({ flag, value, values });
  }
  if (args.length % 2 === 0) {
    throw new Error("Setup arguments are incomplete.");
  }
  return values;
}

function assignSetupArgument(input) {
  if (input.flag === "--device-code") {
    input.values.deviceCode = input.value;
    return;
  }
  if (input.flag === "--local-agents") {
    if (input.value !== "all" && input.value !== "none") {
      throw new Error("Local Agent selection must be all or none.");
    }
    input.values.localAgents = input.value;
    return;
  }
  if (input.flag === "--ott") {
    input.values.ott = input.value;
    return;
  }
  if (input.flag === "--start-session") {
    input.values.startSession = input.value;
    return;
  }
  if (input.value !== "agent" && input.value !== "human") {
    throw new Error("Setup view must be human or agent.");
  }
  input.values.view = input.value;
}

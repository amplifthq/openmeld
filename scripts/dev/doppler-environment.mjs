#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const INTERNAL_CHECK_SOURCE_COMMAND = "__check-source";
const INTERNAL_RUN_COMPONENT_COMMAND = "__run-component";
const INTERNAL_RUN_STAGING_COMPONENT_COMMAND = "__run-staging-component";
const DOPPLER_CLI_INSTALL_URL = "https://docs.doppler.com/docs/install-cli";
const CLOUDFLARE_NATIVE_API_TOKEN_VARIABLE = "CLOUDFLARE_API_TOKEN";
const OPENMELD_RELEASE_API_TOKEN_VARIABLE =
  "CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN";

export const DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE =
  "OPENMELD_DEV_ENVIRONMENT_SOURCE";
export const DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE = "doppler";
export const DOPPLER_DEVELOPMENT_COMPONENT_VARIABLE =
  "OPENMELD_DEV_DOPPLER_COMPONENT";

export const DEVELOPMENT_SECRET_SOURCES = [
  {
    config: "dev",
    optionalSecrets: [],
    project: "openmeld-web",
    requiredSecrets: ["WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"],
  },
  {
    config: "dev",
    optionalSecrets: [],
    project: "openmeld-auth",
    requiredSecrets: [
      "BETTER_AUTH_OPENMELD_SECRET",
      "GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET",
      "GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET",
    ],
  },
  {
    config: "dev",
    optionalSecrets: ["GITHUB_OPENMELD_API_TOKEN"],
    project: "openmeld-core",
    requiredSecrets: [
      "SLACK_OPENMELD_BOT_TOKEN",
      "SLACK_OPENMELD_TOKEN_CRYPTO_KEY",
      "LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY",
      "ZEP_OPENMELD_API_KEY",
    ],
  },
  {
    config: "dev",
    optionalSecrets: ["OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN"],
    project: "openmeld-gateway",
    requiredSecrets: [
      "SLACK_OPENMELD_OAUTH_CLIENT_ID",
      "SLACK_OPENMELD_OAUTH_CLIENT_SECRET",
      "SLACK_OPENMELD_SIGNING_SECRET",
    ],
  },
  {
    config: "dev",
    optionalSecrets: [],
    project: "openmeld-remote-agent",
    requiredSecrets: [
      "CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN",
      "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN",
    ],
  },
];

const DEVELOPMENT_COMPONENT_PROJECTS = new Map([
  ["web", ["openmeld-web"]],
  ["auth", ["openmeld-auth", "openmeld-core"]],
  ["gateway", ["openmeld-gateway"]],
  ["remote-agent", ["openmeld-remote-agent"]],
]);

export const PRODUCTION_WORKER_SECRET_SOURCES = DEVELOPMENT_SECRET_SOURCES.map(
  (source) => ({
    ...source,
    config: "prd",
    requiredSecrets: [...source.requiredSecrets, ...source.optionalSecrets],
    optionalSecrets: [],
  })
);

export const STAGING_WORKER_SECRET_SOURCES = [
  {
    config: "stg",
    optionalSecrets: [],
    project: "openmeld-release",
    requiredSecrets: [
      "CLOUDFLARE_ACCOUNT_ID",
      OPENMELD_RELEASE_API_TOKEN_VARIABLE,
    ],
  },
  {
    config: "stg",
    optionalSecrets: [],
    project: "openmeld-web",
    requiredSecrets: ["WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"],
  },
  {
    config: "stg",
    optionalSecrets: [],
    project: "openmeld-auth",
    requiredSecrets: ["BETTER_AUTH_OPENMELD_SECRET"],
  },
  {
    config: "stg",
    optionalSecrets: ["OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN"],
    project: "openmeld-remote-agent",
    requiredSecrets: ["CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN"],
  },
  {
    config: "stg",
    optionalSecrets: ["SLACK_OPENMELD_TOKEN_CRYPTO_KEY"],
    project: "openmeld-core",
    requiredSecrets: [],
  },
  {
    config: "stg",
    optionalSecrets: [
      "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
      "SLACK_OPENMELD_OAUTH_CLIENT_ID",
      "SLACK_OPENMELD_OAUTH_CLIENT_SECRET",
      "SLACK_OPENMELD_SIGNING_SECRET",
    ],
    project: "openmeld-gateway",
    requiredSecrets: [],
  },
];

const STAGING_OPEN_CONNECTOR_SECRET_SOURCE = {
  config: "stg",
  project: "openmeld-open-connector",
  optionalSecrets: [],
  requiredSecrets: [
    "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
    "OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY",
    "OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID",
    "OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY",
    "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN",
  ],
};

const STAGING_COMPONENT_PROJECTS = new Map([
  ["open-connector", ["openmeld-release", "openmeld-open-connector"]],
  ["release", ["openmeld-release"]],
  ["web", ["openmeld-release", "openmeld-web"]],
  ["auth", ["openmeld-release", "openmeld-auth"]],
  ["core", ["openmeld-release", "openmeld-core"]],
  ["gateway", ["openmeld-release", "openmeld-gateway"]],
  ["remote-agent", ["openmeld-release", "openmeld-remote-agent"]],
]);

const LOCAL_WORKER_DIRECTORIES = [
  "clients/web",
  "services/auth",
  "services/core",
  "services/gateway",
  "services/remote-agent",
];
const LOCAL_SHADOW_FILE_NAMES = [".dev.vars", ".env", ".env.local"];

const OPTIONAL_CAPABILITY_DESCRIPTIONS = new Map([
  [
    "GITHUB_OPENMELD_API_TOKEN",
    "GitHub metadata reads use the anonymous rate limit when absent.",
  ],
  [
    "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
    "OpenConnector administration is unavailable when absent.",
  ],
]);

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`[doppler-environment] ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "help":
      printHelp();
      return;
    case "doctor":
      assertNoLocalShadowFiles(repoRoot);
      process.exitCode = await checkDopplerSources({
        production: false,
        sources: DEVELOPMENT_SECRET_SOURCES,
      });
      return;
    case "doctor:prod":
      process.exitCode = await checkDopplerSources({
        production: true,
        sources: PRODUCTION_WORKER_SECRET_SOURCES,
      });
      return;
    case "doctor:stg":
      assertNoLocalShadowFiles(repoRoot);
      process.exitCode = await checkDopplerSources({
        environmentLabel: "staging Worker",
        readOnly: true,
        sources: STAGING_WORKER_SECRET_SOURCES,
      });
      return;
    case "run": {
      assertNoLocalShadowFiles(repoRoot);
      const targetArgs = stripCommandSeparator(args);
      if (targetArgs.length === 0) {
        throw new Error(
          "Doppler development launcher did not receive a command."
        );
      }
      const readinessExitCode = await checkDopplerSources({
        production: false,
        sources: DEVELOPMENT_SECRET_SOURCES,
      });
      if (readinessExitCode !== 0) {
        process.exitCode = readinessExitCode;
        return;
      }
      process.exitCode = await runCommand(targetArgs[0], targetArgs.slice(1), {
        env: buildInjectedEnvironment(process.env),
      });
      return;
    }
    case "component": {
      const component = args[0];
      const targetArgs = stripCommandSeparator(args.slice(1));
      if (targetArgs.length === 0) {
        throw new Error(
          "Usage: doppler-environment.mjs component <web|auth|gateway|remote-agent> -- <command> [arguments]"
        );
      }
      process.exitCode = await launchWithDoppler({
        cwd: process.cwd(),
        terminalArgs: [
          process.execPath,
          scriptPath,
          INTERNAL_RUN_COMPONENT_COMMAND,
          component,
          ...targetArgs,
        ],
        sources: resolveDevelopmentComponentSources(component),
      });
      return;
    }
    case "component:stg": {
      assertNoLocalShadowFiles(repoRoot);
      const component = args[0];
      const targetArgs = stripCommandSeparator(args.slice(1));
      if (targetArgs.length === 0) {
        throw new Error(
          "Usage: doppler-environment.mjs component:stg <release|web|auth|core|gateway|remote-agent|open-connector> -- <command> [arguments]"
        );
      }
      const sources = resolveStagingComponentSources(component);
      const readinessExitCode = await checkDopplerSources({
        environmentLabel: `${component} staging`,
        readOnly: true,
        sources,
      });
      if (readinessExitCode !== 0) {
        process.exitCode = readinessExitCode;
        return;
      }
      process.exitCode = await launchWithDoppler({
        cwd: process.cwd(),
        sources,
        terminalArgs: [
          process.execPath,
          scriptPath,
          INTERNAL_RUN_STAGING_COMPONENT_COMMAND,
          component,
          ...targetArgs,
        ],
      });
      return;
    }
    case INTERNAL_CHECK_SOURCE_COMMAND:
      process.exitCode = runSourceEnvironmentCheck(args[0], args[1]);
      return;
    case INTERNAL_RUN_COMPONENT_COMMAND:
      await runInjectedComponentCommand(args[0], args.slice(1));
      return;
    case INTERNAL_RUN_STAGING_COMPONENT_COMMAND:
      await runInjectedStagingComponentCommand(args[0], args.slice(1));
      return;
    default:
      printHelp();
      process.exitCode = command ? 1 : 0;
  }
}

export function buildNestedDopplerCommand(input) {
  const dopplerCommand = input.dopplerCommand ?? "doppler";
  let command = {
    args: input.terminalArgs.slice(1),
    executable: input.terminalArgs[0],
  };

  for (const source of [...input.sources].reverse()) {
    const secretNames = [...source.requiredSecrets, ...source.optionalSecrets];
    command = {
      executable: dopplerCommand,
      args: [
        "--silent",
        "run",
        "--project",
        source.project,
        "--config",
        source.config,
        "--only-secrets",
        secretNames.join(","),
        "--no-exit-on-missing-only-secrets",
        "--no-fallback",
        "--forward-signals=true",
        "--",
        command.executable,
        ...command.args,
      ],
    };
  }

  return command;
}

export function buildDopplerComponentCommand(component, terminalArgs) {
  resolveDevelopmentComponentSources(component);
  return {
    args: [scriptPath, "component", component, "--", ...terminalArgs],
    executable: process.execPath,
  };
}

export function findLocalShadowFiles(targetRepoRoot) {
  return LOCAL_WORKER_DIRECTORIES.flatMap((directory) =>
    LOCAL_SHADOW_FILE_NAMES.map((fileName) =>
      resolve(targetRepoRoot, directory, fileName)
    )
  ).filter((filePath) => existsSync(filePath));
}

export function inspectEnvironment(sources, env = process.env) {
  const requiredSecrets = sources.flatMap((source) => source.requiredSecrets);
  const optionalSecrets = sources.flatMap((source) => source.optionalSecrets);
  return {
    availableOptionalSecrets: optionalSecrets.filter((name) =>
      hasEnvironmentValue(env, name)
    ),
    missingOptionalSecrets: optionalSecrets.filter(
      (name) => !hasEnvironmentValue(env, name)
    ),
    missingRequiredSecrets: requiredSecrets.filter(
      (name) => !hasEnvironmentValue(env, name)
    ),
    requiredSecretCount: requiredSecrets.length,
  };
}

export function buildInjectedEnvironment(env = process.env) {
  const injectedEnvironment = stripManagedSecrets(env);
  return {
    ...injectedEnvironment,
    [DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE]:
      DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE,
  };
}

export function stripManagedSecrets(
  env = process.env,
  sources = DEVELOPMENT_SECRET_SOURCES
) {
  const sanitizedEnvironment = { ...env };
  for (const secretName of getSecretNames(sources)) {
    delete sanitizedEnvironment[secretName];
  }
  delete sanitizedEnvironment[DOPPLER_DEVELOPMENT_COMPONENT_VARIABLE];
  return sanitizedEnvironment;
}

export function buildInjectedComponentEnvironment(
  component,
  env = process.env
) {
  const sources = resolveDevelopmentComponentSources(component);
  const injectedEnvironment = buildInjectedEnvironment(env);
  for (const secretName of getSecretNames(sources)) {
    if (secretName in env) {
      injectedEnvironment[secretName] = env[secretName];
    }
  }
  injectedEnvironment[DOPPLER_DEVELOPMENT_COMPONENT_VARIABLE] = component;
  return injectedEnvironment;
}

export function buildInjectedStagingComponentEnvironment(
  component,
  env = process.env
) {
  const sources = resolveStagingComponentSources(component);
  const injectedEnvironment = stripManagedSecrets(
    env,
    allManagedSecretSources()
  );
  delete injectedEnvironment[CLOUDFLARE_NATIVE_API_TOKEN_VARIABLE];

  for (const secretName of getSecretNames(sources)) {
    if (
      secretName in env &&
      secretName !== OPENMELD_RELEASE_API_TOKEN_VARIABLE
    ) {
      injectedEnvironment[secretName] = env[secretName];
    }
  }

  if (OPENMELD_RELEASE_API_TOKEN_VARIABLE in env) {
    injectedEnvironment[CLOUDFLARE_NATIVE_API_TOKEN_VARIABLE] =
      env[OPENMELD_RELEASE_API_TOKEN_VARIABLE];
  }
  return injectedEnvironment;
}

export function resolveDevelopmentComponentSources(component) {
  const projects = DEVELOPMENT_COMPONENT_PROJECTS.get(component);
  if (!projects) {
    throw new Error(`Unsupported Doppler development component: ${component}`);
  }
  return projects.map((project) => {
    const source = DEVELOPMENT_SECRET_SOURCES.find(
      (candidate) => candidate.project === project
    );
    if (!source) {
      throw new Error(`Missing Doppler development source for ${project}.`);
    }
    return source;
  });
}

export function resolveStagingComponentSources(component) {
  const projects = STAGING_COMPONENT_PROJECTS.get(component);
  if (!projects) {
    throw new Error(`Unsupported Doppler staging component: ${component}`);
  }
  return projects.map((project) => {
    if (project === "openmeld-open-connector") {
      return STAGING_OPEN_CONNECTOR_SECRET_SOURCE;
    }
    const source = STAGING_WORKER_SECRET_SOURCES.find(
      (candidate) => candidate.project === project
    );
    if (!source) {
      throw new Error(`Missing Doppler staging source for ${project}.`);
    }
    return source;
  });
}

function assertNoLocalShadowFiles(targetRepoRoot) {
  const shadowFiles = findLocalShadowFiles(targetRepoRoot);
  if (shadowFiles.length === 0) {
    return;
  }

  const relativePaths = shadowFiles.map((filePath) =>
    filePath.replace(`${targetRepoRoot}/`, "")
  );
  throw new Error(
    [
      "Doppler was not started because local files would override its values:",
      ...relativePaths.map((filePath) => `- ${filePath}`),
      "For a legacy checkout, keep using pnpm dev:isolated. To use the shared Doppler workflow, move these files aside yourself and run pnpm dev:doctor again.",
      "Never delete or print a secret file on an agent's behalf.",
    ].join("\n")
  );
}

async function launchWithDoppler(input) {
  const command = buildNestedDopplerCommand(input);
  return await runCommand(command.executable, command.args, {
    cwd: input.cwd,
    env: stripManagedSecrets(process.env, allManagedSecretSources()),
  });
}

async function checkDopplerSources(input) {
  let exitCode = 0;
  for (const source of input.sources) {
    const sourceExitCode = await launchWithDoppler({
      sources: [source],
      terminalArgs: [
        process.execPath,
        scriptPath,
        INTERNAL_CHECK_SOURCE_COMMAND,
        source.project,
        source.config,
      ],
    });
    if (sourceExitCode !== 0) {
      exitCode = 1;
    }
  }

  if (exitCode !== 0) {
    if (input.production || input.readOnly) {
      console.error(
        "[doppler] This was a read-only check. No deployment or secret synchronization was attempted."
      );
    }
    return exitCode;
  }

  const requiredSecretCount = input.sources.reduce(
    (count, source) => count + source.requiredSecrets.length,
    0
  );
  const label =
    input.environmentLabel ??
    (input.production ? "production Worker" : "shared development");
  console.log(
    `[doppler] ${label} environment is ready (${String(requiredSecretCount)}/${String(requiredSecretCount)} required secrets available).`
  );
  if (input.production || input.readOnly) {
    console.log(
      "[doppler] Read-only readiness passed. Deployment remains a separate, explicitly authorized release action."
    );
  } else {
    console.log(
      "[doppler] No local .dev.vars, .env, or .env.local file shadows Doppler."
    );
  }
  return 0;
}

function runSourceEnvironmentCheck(project, config) {
  const source = [
    STAGING_OPEN_CONNECTOR_SECRET_SOURCE,
    ...DEVELOPMENT_SECRET_SOURCES,
    ...PRODUCTION_WORKER_SECRET_SOURCES,
    ...STAGING_WORKER_SECRET_SOURCES,
  ].find(
    (candidate) => candidate.project === project && candidate.config === config
  );
  if (!source) {
    throw new Error(`Unsupported Doppler source: ${project}/${config}`);
  }

  const inspection = inspectEnvironment([source]);
  const label = `${source.project}/${source.config}`;

  if (inspection.missingRequiredSecrets.length > 0) {
    console.error(
      `[doppler] ${label} is not ready. Missing ${String(inspection.missingRequiredSecrets.length)} required secret(s):`
    );
    for (const secretName of inspection.missingRequiredSecrets) {
      console.error(`[doppler] - ${secretName}`);
    }
    return 1;
  }

  console.log(
    `[doppler] Ready: ${label} (${String(inspection.requiredSecretCount)}/${String(inspection.requiredSecretCount)} required secrets).`
  );
  if (source.config === "dev") {
    printOptionalCapabilities(inspection);
  }
  return 0;
}

async function runInjectedComponentCommand(component, args) {
  const sources = resolveDevelopmentComponentSources(component);
  const inspection = inspectEnvironment(sources);
  if (inspection.missingRequiredSecrets.length > 0) {
    throw new Error(
      `${component} development environment is missing: ${inspection.missingRequiredSecrets.join(", ")}`
    );
  }
  if (args.length === 0) {
    throw new Error(
      `Doppler did not receive a ${component} development command to run.`
    );
  }

  const exitCode = await runCommand(args[0], args.slice(1), {
    cwd: process.cwd(),
    env: buildInjectedComponentEnvironment(component),
  });
  process.exitCode = exitCode;
}

async function runInjectedStagingComponentCommand(component, args) {
  const sources = resolveStagingComponentSources(component);
  const inspection = inspectEnvironment(sources);
  if (inspection.missingRequiredSecrets.length > 0) {
    throw new Error(
      `${component} staging environment is missing: ${inspection.missingRequiredSecrets.join(", ")}`
    );
  }
  if (args.length === 0) {
    throw new Error(
      `Doppler did not receive a ${component} staging command to run.`
    );
  }

  const exitCode = await runCommand(args[0], args.slice(1), {
    cwd: process.cwd(),
    env: buildInjectedStagingComponentEnvironment(component),
  });
  process.exitCode = exitCode;
}

function printOptionalCapabilities(inspection) {
  for (const secretName of inspection.availableOptionalSecrets) {
    console.log(`[doppler] Optional capability available: ${secretName}.`);
  }
  for (const secretName of inspection.missingOptionalSecrets) {
    const description = OPTIONAL_CAPABILITY_DESCRIPTIONS.get(secretName) ?? "";
    console.log(
      `[doppler] Optional capability unavailable: ${secretName}. ${description}`.trim()
    );
  }
}

function runCommand(executable, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env,
      stdio: "inherit",
    });
    const forwardSigint = () => child.kill("SIGINT");
    const forwardSigterm = () => child.kill("SIGTERM");
    process.once("SIGINT", forwardSigint);
    process.once("SIGTERM", forwardSigterm);

    const removeSignalHandlers = () => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
    };
    child.once("error", (error) => {
      removeSignalHandlers();
      reject(buildCommandLaunchError(executable, error));
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      resolvePromise(signal ? 1 : (code ?? 1));
    });
  });
}

function buildCommandLaunchError(executable, error) {
  if (
    executable === "doppler" &&
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return new Error(
      `Doppler CLI is required. Install it from ${DOPPLER_CLI_INSTALL_URL}, then run doppler login and pnpm dev:doctor.`
    );
  }
  return error;
}

function hasEnvironmentValue(env, name) {
  return typeof env[name] === "string" && env[name].trim().length > 0;
}

function getSecretNames(sources) {
  return sources.flatMap((source) => [
    ...source.requiredSecrets,
    ...source.optionalSecrets,
  ]);
}

function allManagedSecretSources() {
  return [
    ...DEVELOPMENT_SECRET_SOURCES,
    ...PRODUCTION_WORKER_SECRET_SOURCES,
    ...STAGING_WORKER_SECRET_SOURCES,
  ];
}

function stripCommandSeparator(args) {
  return args[0] === "--" ? args.slice(1) : args;
}

function printHelp() {
  console.log(
    [
      "OpenMeld local development",
      "",
      "Required toolchain:",
      "  Node 24 and pnpm 10",
      "  corepack enable",
      "  corepack install",
      "",
      "First use on a computer:",
      `  Install Doppler CLI: ${DOPPLER_CLI_INSTALL_URL}`,
      "  doppler login",
      "  pnpm install --frozen-lockfile",
      "",
      "Recommended commands:",
      "  pnpm dev:doctor             Check Doppler access and required development values",
      "  pnpm dev:worktree           Start the worktree Worker stack; Docker is not required",
      "  pnpm dev:web:worktree       Start Web in a second terminal after the Worker stack is ready",
      "  pnpm dev:worktree:sandbox   Start the Worker stack with Remote Agent Sandbox tools; Docker is required",
      "  pnpm dev:stop               Stop OpenMeld development processes in this checkout",
      "",
      "Stop a normal session with Ctrl+C in both terminals. Use pnpm dev:stop -- --dry-run before cleaning up unexpected leftovers.",
      "",
      "Advanced compatibility commands:",
      "  pnpm env:doctor",
      "  pnpm env:doctor:prod        Read-only production readiness check; never deploys",
      "  pnpm env:doctor:stg         Read-only staging readiness check; never deploys",
    ].join("\n")
  );
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isDirectExecution() {
  return process.argv[1] && resolve(process.argv[1]) === scriptPath;
}

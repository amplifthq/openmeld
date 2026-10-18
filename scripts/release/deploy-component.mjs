#!/usr/bin/env node

// Runs one component's build -> deploy -> health steps from release/components.mjs
// against the checked-out release source in the current directory. The local
// lane and .github/workflows/deploy.yml both call this script; it never decides
// scope or order.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { COMPONENTS } from "../../release/components.mjs";
import { readLiveReleaseSha, readNpmGitHead } from "./live-release.mjs";

const CONTROL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const FULL_SHA = /^[0-9a-f]{40}$/u;
const HEALTH_WAIT_MS = 120_000;

export function findComponent(name) {
  const component = COMPONENTS.find((entry) => entry.name === name);
  if (!component) {
    throw new Error(
      `Unknown component "${name}". Known: ${COMPONENTS.map((entry) => entry.name).join(", ")}.`
    );
  }
  return component;
}

// Wrangler reads CLOUDFLARE_API_TOKEN; PostgreSQL tooling reads the scoped
// release token name. Doppler stores the token once.
export function releaseEnvironment(env, sha) {
  const token =
    env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN;
  const missing = [
    !env.CLOUDFLARE_ACCOUNT_ID && "CLOUDFLARE_ACCOUNT_ID",
    !token && "CLOUDFLARE_API_TOKEN (or CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN)",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Production release credentials are missing: ${missing.join(", ")}.`
    );
  }
  return {
    ...env,
    RELEASE_SHA: sha,
    ...(token
      ? {
          CLOUDFLARE_API_TOKEN: token,
          CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN: token,
        }
      : {}),
  };
}

export function assertReleaseCheckout({ cwd, sha, git = gitOutput }) {
  const head = git(cwd, ["rev-parse", "HEAD"]);
  if (head !== sha) {
    throw new Error(
      `Checked-out source ${head} is not the release SHA ${sha}.`
    );
  }
  if (git(cwd, ["status", "--porcelain"])) {
    throw new Error("The release checkout has uncommitted changes.");
  }
}

function gitOutput(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function run(command, { cwd, env }) {
  process.stdout.write(`\n$ ${command.join(" ")}\n`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command.join(" ")} failed with exit code ${String(result.status)}.`
    );
  }
}

function healthCommand(component, sha) {
  const { health } = component;
  if (health.kind === "command") {
    return controlCommand(health.command);
  }
  if (health.kind === "renderer") {
    return [
      "node",
      path.join(CONTROL_ROOT, "scripts/release/production-web-health.mjs"),
      "--scope",
      component.name,
      "--url",
      health.url,
      "--source-sha",
      sha,
      "--artifact-receipt",
      `dev-tmp/release-artifact-check/${component.name}.json`,
    ];
  }
  return null;
}

async function waitForLiveSha({ component, sha, cwd, env }) {
  const deadline = Date.now() + HEALTH_WAIT_MS;
  const read = () => {
    if (component.health.kind === "cli") {
      const { version } = JSON.parse(
        readFileSync(
          path.join(cwd, "clients/openmeld-cli/package.json"),
          "utf8"
        )
      );
      return readNpmGitHead(version);
    }
    return readLiveReleaseSha(component, COMPONENTS, { env });
  };
  for (;;) {
    let observed = null;
    let failure = null;
    try {
      observed = await read();
    } catch (error) {
      failure = error;
    }
    if (observed === sha) {
      process.stdout.write(`${component.name} reports RELEASE_SHA ${sha}.\n`);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${component.name} health failed: expected RELEASE_SHA ${sha}, observed ${observed ?? "none"}${failure ? ` (${failure.message})` : ""}.`
      );
    }
    await sleep(5000);
  }
}

export function describeComponentSteps(component, sha) {
  return {
    deploy: component.deploy(sha).map(controlCommand),
    health: healthCommand(component, sha) ?? [
      `check live RELEASE_SHA (${component.health.kind})`,
    ],
  };
}

function controlCommand(command) {
  return command[0] === "node"
    ? [
        process.execPath,
        path.resolve(CONTROL_ROOT, command[1]),
        ...command.slice(2),
      ]
    : command;
}

export async function deployComponent({
  name,
  sha,
  cwd = process.cwd(),
  env = process.env,
  dryRun = false,
}) {
  if (!FULL_SHA.test(sha ?? "")) {
    throw new Error(
      "--sha must be an exact 40-character lowercase commit SHA."
    );
  }
  const component = findComponent(name);
  const steps = describeComponentSteps(component, sha);
  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify({ component: name, sha, ...steps }, null, 2)}\n`
    );
    return;
  }
  assertReleaseCheckout({ cwd, sha });
  const childEnv = {
    ...releaseEnvironment(env, sha),
    OPENMELD_RELEASE_SOURCE_ROOT: path.resolve(cwd),
  };
  const startedAt = Date.now();
  for (const command of steps.deploy) {
    run(command, { cwd, env: childEnv });
  }
  const command = healthCommand(component, sha);
  if (command) {
    run(command, { cwd, env: childEnv });
  } else {
    await waitForLiveSha({ component, sha, cwd, env: childEnv });
  }
  process.stdout.write(
    `${name} released ${sha} in ${Math.round((Date.now() - startedAt) / 1000)}s.\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      sha: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  try {
    if (positionals.length !== 1) {
      throw new Error(
        "Usage: deploy-component.mjs <component> --sha <sha> [--dry-run]"
      );
    }
    await deployComponent({
      name: positionals[0],
      sha: values.sha,
      dryRun: values["dry-run"],
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}

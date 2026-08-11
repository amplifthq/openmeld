#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  normalizeFreshWebStartCleanupEmail,
  runFreshWebStartUserCleanup,
} from "../../packages/db/src/tooling/fresh-web-start-user-cleanup.ts";

const DEFAULT_OPENMELD_HOME = join(tmpdir(), "openmeld-web-start-fresh");

type FreshWebStartCliOptions = {
  openMeldHome: string;
  clearAuthSessions: boolean;
  email: string;
  printShellExport: boolean;
};

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCli(argv);
  const cleanup = runFreshWebStartUserCleanup({
    clearAuthSessions: options.clearAuthSessions,
    email: options.email,
  });

  await recreateFreshOpenMeldHome(options.openMeldHome);

  if (options.printShellExport) {
    process.stdout.write(renderShellExport(options.openMeldHome));
    return;
  }

  process.stdout.write(
    [
      "Prepared a fresh OpenMeld Web Start validation environment.",
      "",
      `Test account: ${cleanup.email}`,
      `User ID: ${cleanup.userId}`,
      "Local OPENMELD_DB targets:",
      ...cleanup.localDbTargets.map(
        (target) => `- ${target.services.join("+")}: ${target.localDbPath}`
      ),
      `Fresh OPENMELD_HOME: ${options.openMeldHome}`,
      "",
      "Cleared OpenMeld product data for this account:",
      ...formatCleanupCounts(cleanup.counts),
      "",
      cleanup.clearAuthSessions
        ? "Also cleared server-side auth sessions for this account."
        : "Server-side auth sessions were kept. Manual browser data cleanup is still the standard Web step.",
      "",
      "Next steps:",
      "1. Clear local browser site data for OpenMeld Web/Auth/Gateway, or use a clean browser profile, then sign in again with this test account.",
      `2. Activate this fresh CLI and Web dev home in the current terminal: export OPENMELD_HOME="${options.openMeldHome}" && export VITE_OPENMELD_HOME="$OPENMELD_HOME"`,
      `3. Or do the same thing in one step: eval "$(pnpm -s dev:prepare:fresh-web-start --email ${cleanup.email}${options.clearAuthSessions ? " --clear-auth-sessions" : ""} --print-shell-export)"`,
      "4. Verify the fresh CLI state: openmeld-dev auth status --view human",
      "5. Start or restart OpenMeld Web from this same terminal so Web-generated dev commands use the same fresh OpenMeld home.",
      "6. Continue local validation with commands like: openmeld-dev start",
      "7. When you are done testing, stop any fresh-lane OpenMeld Service before restoring the default dev lane: openmeld-dev service stop --force --view agent",
      "8. Then restore the default dev lane with: unset OPENMELD_HOME",
      "",
      "Notes:",
      "- This keeps the machine's installed tools such as Codex and Claude Code untouched.",
      "- This cleans OpenMeld onboarding/profile/device/start data for the account, not the auth identity itself.",
      "- This command does not change browser data. For first-run Web validation, clear relevant localhost site data manually before signing in.",
      "- This command does not migrate the local database. If OpenMeld Web shows a database schema error, run `pnpm db:migrate:dev`, restart the dev stack, then test again.",
      '- A child process cannot mutate your current shell, so automatic activation must be done with `export ...` or `eval "$(...)"`.',
      '- Use `pnpm -s` with `eval "$( ... )"` so pnpm lifecycle logs do not get executed as shell commands.',
      "- If the local shared OPENMELD_DB is busy, stop the local stack with `pnpm dev:stop`, rerun this command, then restart with `pnpm dev`.",
      "",
    ].join("\n")
  );
}

export function parseCli(argv: readonly string[]): FreshWebStartCliOptions {
  const rawOptions = readRawCliOptions(argv);
  const emailValue = rawOptions.email;
  if (!emailValue) {
    throw new Error(
      "prepare-fresh-web-start-cli requires --email <test-account-email>"
    );
  }

  return {
    openMeldHome: resolveFreshOpenMeldHome(rawOptions["openmeld-home"]),
    clearAuthSessions: rawOptions["clear-auth-sessions"] === "true",
    email: normalizeFreshWebStartCleanupEmail(emailValue),
    printShellExport: rawOptions["print-shell-export"] === "true",
  };
}

export function resolveFreshOpenMeldHome(
  rawOpenMeldHome: string | undefined
): string {
  const candidate = String(rawOpenMeldHome ?? DEFAULT_OPENMELD_HOME).trim();
  if (candidate.length === 0) {
    throw new Error(
      "prepare-fresh-web-start-cli requires a non-empty OPENMELD_HOME"
    );
  }

  const resolved = resolve(candidate);
  assertSafeTempOpenMeldHome(resolved);
  return resolved;
}

export function assertSafeTempOpenMeldHome(openMeldHome: string): void {
  const tempRoot = resolve(tmpdir());
  const candidate = resolve(openMeldHome);
  const relativePath = relative(tempRoot, candidate);

  if (candidate === tempRoot) {
    throw new Error(
      "prepare-fresh-web-start-cli refuses to use the temp root itself as OPENMELD_HOME"
    );
  }
  if (relativePath.length === 0) {
    throw new Error(
      "prepare-fresh-web-start-cli requires OPENMELD_HOME to point at a child directory under the system temp root"
    );
  }
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(
      `prepare-fresh-web-start-cli only allows OPENMELD_HOME under ${tempRoot}`
    );
  }
}

export async function recreateFreshOpenMeldHome(
  openMeldHome: string
): Promise<void> {
  await rm(openMeldHome, {
    force: true,
    recursive: true,
  });
  await mkdir(openMeldHome, {
    recursive: true,
  });
}

export function renderShellExport(openMeldHome: string): string {
  const escapedOpenMeldHome = openMeldHome
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  return [
    `export OPENMELD_HOME="${escapedOpenMeldHome}"`,
    `export VITE_OPENMELD_HOME="${escapedOpenMeldHome}"`,
    `printf '%s\\n' 'OPENMELD_HOME now points to the fresh validation lane.' >&2`,
    `printf '%s\\n' 'VITE_OPENMELD_HOME now points OpenMeld Web dev commands to the same fresh validation lane.' >&2`,
    `printf '%s\\n' 'Browser data is not changed. Clear OpenMeld localhost site data manually before first-run Web validation.' >&2`,
    `printf '%s\\n' 'Local DB migrations are not changed. If OpenMeld Web shows a schema error, run pnpm db:migrate:dev and restart the dev stack.' >&2`,
    `printf '%s\\n' 'When done testing, stop any fresh-lane OpenMeld Service before unsetting: openmeld-dev service stop --force --view agent' >&2`,
    `printf '%s\\n' 'Run unset OPENMELD_HOME when you want to return to the default openmeld-dev home.' >&2`,
    "",
  ].join("\n");
}

function formatCleanupCounts(
  counts: ReturnType<typeof runFreshWebStartUserCleanup>["counts"]
): string[] {
  return [
    `- openmeld_profiles: ${counts.openMeldProfiles}`,
    `- openmeld_profile_space_history: ${counts.openMeldProfileSpaceHistory}`,
    `- openmeld_space_deletion_tombstones: ${counts.openMeldSpaceDeletionTombstones}`,
    `- openMeldDaemon_owned_devices: ${counts.openMeldDaemonOwnedDevices}`,
    `- openMeldDaemon_current_device_targets: ${counts.openMeldDaemonCurrentDeviceTargets}`,
    `- auth sessions: ${counts.authSessions}`,
    `- auth one-time tokens: ${counts.authOneTimeTokenVerifications}`,
  ];
}

function readRawCliOptions(argv: readonly string[]): Record<string, string> {
  const options: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${String(token ?? "")}`);
    }

    const withoutPrefix = token.slice(2);
    if (withoutPrefix.length === 0) {
      throw new Error("Unexpected empty option token");
    }

    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      const key = withoutPrefix.slice(0, equalsIndex);
      const value = withoutPrefix.slice(equalsIndex + 1);
      options[key] = value;
      continue;
    }

    const nextToken = argv[index + 1];
    if (!nextToken || nextToken.startsWith("--")) {
      options[withoutPrefix] = "true";
      continue;
    }

    options[withoutPrefix] = nextToken;
    index += 1;
  }

  return options;
}

if (process.argv[1]) {
  const entryPath = resolve(process.argv[1]);
  if (entryPath === resolve(import.meta.filename)) {
    main().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
  }
}

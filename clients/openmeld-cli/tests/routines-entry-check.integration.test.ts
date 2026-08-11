import { cliJsonErrorEnvelopeSchema } from "@openmeld/schemas";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSelectedOpenMeldProfileId } from "../src/config/openmeld-profile-selection";
import { setProfileDefaultView } from "../src/config/profile-view";
import { runRoutinesCliCommand } from "../src/routines/entry";
import { registerRoutinesCommands } from "../src/routines/registration";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const PROFILE_ID = "codex--aaaaaaaa";

describe("Routines CLI entry checks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps Agent, configured Agent, JSON, and Human blockers on their own protocols", async () => {
    await withTempHome(async () => {
      const previousArgv = process.argv;
      const previousExitCode = process.exitCode;
      const previousDisclaimer = process.env.OPENMELD_ACCEPT_DISCLAIMER;
      const previousUpgradeSkip =
        process.env.OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE;
      process.env.OPENMELD_ACCEPT_DISCLAIMER = "1";
      process.env.OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE = "1";
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";

      await setSelectedOpenMeldProfileId(PROFILE_ID);
      await setProfileDefaultView({
        openMeldProfileId: PROFILE_ID,
        view: "agent",
      });

      const routineApiHandler = vi.fn(async () => undefined);

      try {
        const explicitAgent = await runListEntry({
          argv: ["--view", "agent", "routines", "list"],
          routineApiHandler,
        });
        expect(parseSingleLine(explicitAgent.stdout)).toMatchObject({
          type: "result",
          code: "command.entry.sign_in.blocked",
          payload: {
            code: "auth.authentication_required",
            status: "blocked",
          },
        });
        expect(explicitAgent.stdout).not.toContain("schemaVersion");

        const configuredAgent = await runListEntry({
          argv: ["routines", "list"],
          routineApiHandler,
        });
        expect(parseSingleLine(configuredAgent.stdout)).toMatchObject({
          type: "result",
          code: "command.entry.sign_in.blocked",
          payload: {
            code: "auth.authentication_required",
            status: "blocked",
          },
        });
        expect(configuredAgent.stdout).not.toContain("schemaVersion");

        const json = await runListEntry({
          argv: ["--view", "human", "routines", "list", "--json"],
          routineApiHandler,
        });
        const jsonEnvelope = parseSingleLine(json.stdout);
        expect(cliJsonErrorEnvelopeSchema.parse(jsonEnvelope)).toMatchObject({
          schemaVersion: 1,
          type: "error",
          error: { code: "auth.authentication_required" },
        });

        const human = await runListEntry({
          argv: ["--view", "human", "routines", "list"],
          routineApiHandler,
        });
        expect(human.plainStdout).toContain("Sign In Needed");
        expect(findJsonFrames(human.stdout)).toEqual([]);
        expect(human.stdout).not.toContain('"schemaVersion"');

        expect(routineApiHandler).not.toHaveBeenCalled();
      } finally {
        process.argv = previousArgv;
        process.exitCode = previousExitCode;
        restoreEnv("OPENMELD_ACCEPT_DISCLAIMER", previousDisclaimer);
        restoreEnv(
          "OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE",
          previousUpgradeSkip
        );
      }
    });
  });
});

async function runListEntry(input: {
  argv: string[];
  routineApiHandler: () => Promise<void>;
}) {
  const program = new Command()
    .name("openmeld")
    .option("--view <view>")
    .exitOverride();
  registerRoutinesCommands(program, {
    create: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: async (options) => {
      await runRoutinesCliCommand({
        command: "list",
        json: options.json,
        run: input.routineApiHandler,
      });
    },
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    runs: vi.fn(async () => undefined),
    show: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
  });

  process.argv = ["node", "openmeld", ...input.argv];
  process.exitCode = undefined;
  return await withCapturedStdio(async () => {
    await program.parseAsync(process.argv);
  });
}

function parseSingleLine(output: string): Record<string, unknown> {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(`Expected one output line, received ${lines.length}.`);
  }
  return JSON.parse(lines[0] ?? "null") as Record<string, unknown>;
}

function findJsonFrames(output: string): Record<string, unknown>[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

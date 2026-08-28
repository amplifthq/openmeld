import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginAuthSessionTransition,
  getAuthSessionState,
  setAuthSession,
} from "../src/config/auth-session";
import { withTempHome } from "./helpers/fs";

describe("auth session transition integrity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
  });

  it("lets only one process atomically claim a new transition", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });

      const barrierDirectory = join(home, "transition-claim-barrier");
      await mkdir(barrierDirectory, { recursive: true });
      const first = spawnRacingAuthSessionTransition({
        accessToken: "first-candidate-token",
        barrierDirectory,
        contenderId: "first",
        userId: "first-candidate-owner",
      });
      const second = spawnRacingAuthSessionTransition({
        accessToken: "second-candidate-token",
        barrierDirectory,
        contenderId: "second",
        userId: "second-candidate-owner",
      });

      await Promise.all([
        waitForFile(join(barrierDirectory, "first.ready")),
        waitForFile(join(barrierDirectory, "second.ready")),
      ]);
      await writeFile(join(barrierDirectory, "release"), "go\n", "utf8");
      const results = await Promise.all([first.result, second.result]);
      const winners = results.filter((result) => result.status === "success");
      const losers = results.filter((result) => result.status === "error");

      expect(winners).toHaveLength(1);
      expect(losers).toMatchObject([
        { errorName: "AuthSessionRecoveryInProgressError" },
      ]);

      const winner = winners[0];
      const authDirectory = join(home, ".openmeld", "auth");
      const journal = JSON.parse(
        await readFile(join(authDirectory, "session-transition.json"), "utf8")
      ) as {
        candidatePayload: { user?: { id?: string } };
      };
      const session = JSON.parse(
        await readFile(join(authDirectory, "session.json"), "utf8")
      ) as { user?: { id?: string } };
      expect(journal.candidatePayload.user?.id).toBe(winner?.userId);
      expect(session.user?.id).toBe(winner?.userId);
      expect(
        (await readdir(join(authDirectory, "tokens"))).filter((name) =>
          name.endsWith(".token")
        )
      ).toHaveLength(2);
    });
  });

  it("restores the previous owner when commit finds its journal missing", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const transition = await beginAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "candidate-owner" },
      });
      await rm(join(home, ".openmeld", "auth", "session-transition.json"), {
        force: true,
      });

      await expect(transition.commit()).rejects.toMatchObject({
        name: "AuthSessionTransitionConflictError",
        reason: "journal_missing",
      });
      await expect(getAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "previous-token",
          user: { id: "previous-owner" },
        },
      });
      await expect(transition.rollback()).resolves.toBeUndefined();
    });
  });

  it("fails closed when commit finds its journal replaced", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const authDirectory = join(home, ".openmeld", "auth");
      const previousPayload = JSON.parse(
        await readFile(join(authDirectory, "session.json"), "utf8")
      ) as { tokenRef: { key: string } };
      const transition = await beginAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "candidate-owner" },
      });
      const transitionPath = join(authDirectory, "session-transition.json");
      const pendingJournal = JSON.parse(
        await readFile(transitionPath, "utf8")
      ) as Record<string, unknown>;
      const replacementJournal = {
        ...pendingJournal,
        id: "replacement-transition",
      };
      await writeFile(
        transitionPath,
        `${JSON.stringify(replacementJournal, null, 2)}\n`,
        "utf8"
      );

      await expect(transition.commit()).rejects.toMatchObject({
        name: "AuthSessionTransitionConflictError",
        reason: "journal_replaced",
      });
      await expect(transition.rollback()).rejects.toMatchObject({
        name: "AuthSessionTransitionConflictError",
        reason: "journal_replaced",
      });
      await expect(readFile(transitionPath, "utf8")).resolves.toBe(
        `${JSON.stringify(replacementJournal, null, 2)}\n`
      );
      await expect(
        readFile(
          join(
            authDirectory,
            "tokens",
            `${previousPayload.tokenRef.key}.token`
          ),
          "utf8"
        )
      ).resolves.toBe("previous-token\n");
      const currentPayload = JSON.parse(
        await readFile(join(authDirectory, "session.json"), "utf8")
      ) as { user?: { id?: string } };
      expect(currentPayload.user?.id).toBe("candidate-owner");
    });
  });
});

type RacingAuthSessionTransitionResult = {
  errorMessage?: string;
  errorName?: string;
  status: "error" | "success";
  userId: string;
};

function spawnRacingAuthSessionTransition(input: {
  accessToken: string;
  barrierDirectory: string;
  contenderId: string;
  userId: string;
}): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const testRequire = createRequire(import.meta.url);
  const vitestRequire = createRequire(
    testRequire.resolve("vitest/package.json")
  );
  const tsxPackagePath = vitestRequire.resolve("tsx/package.json");
  const tsxLoaderPath = join(tsxPackagePath, "..", "dist", "loader.mjs");
  const authSessionModuleUrl = new URL(
    "../src/config/auth-session.ts",
    import.meta.url
  ).href;
  const readyPath = join(input.barrierDirectory, `${input.contenderId}.ready`);
  const releasePath = join(input.barrierDirectory, "release");
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { setTimeout as sleep } from "node:timers/promises";

    const originalOpen = fs.promises.open.bind(fs.promises);
    let pausedAtJournalClaim = false;
    fs.promises.open = async (...args) => {
      const target = String(args[0]);
      if (!pausedAtJournalClaim && target.includes("session-transition.json")) {
        pausedAtJournalClaim = true;
        await fs.promises.writeFile(${JSON.stringify(readyPath)}, "ready\\n", "utf8");
        while (true) {
          const released = await fs.promises.stat(${JSON.stringify(releasePath)}).then(
            () => true,
            (error) => error?.code === "ENOENT" ? false : Promise.reject(error)
          );
          if (released) break;
          await sleep(5);
        }
      }
      return await originalOpen(...args);
    };
    syncBuiltinESMExports();

    const { beginAuthSessionTransition } = await import(${JSON.stringify(authSessionModuleUrl)});
    try {
      await beginAuthSessionTransition({
        accessToken: ${JSON.stringify(input.accessToken)},
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: ${JSON.stringify(input.userId)} },
      });
      process.stdout.write(JSON.stringify({
        status: "success",
        userId: ${JSON.stringify(input.userId)},
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: "error",
        userId: ${JSON.stringify(input.userId)},
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  `;
  const child = spawn(
    process.execPath,
    ["--import", tsxLoaderPath, "--input-type=module", "--eval", script],
    {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  return {
    child,
    result: readRacingAuthSessionTransitionResult(child),
  };
}

async function readRacingAuthSessionTransitionResult(
  child: ChildProcessWithoutNullStreams
): Promise<RacingAuthSessionTransitionResult> {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const [code] = (await once(child, "exit")) as [number | null];
  if (code !== 0) {
    throw new Error(
      `auth session transition race fixture failed with code ${String(code)}: ${stderr}`
    );
  }
  return JSON.parse(stdout) as RacingAuthSessionTransitionResult;
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const exists = await readFile(path, "utf8").then(
      () => true,
      (error: unknown) =>
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
          ? false
          : Promise.reject(error)
    );
    if (exists) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for fixture file ${path}`);
}

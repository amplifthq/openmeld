import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginAuthSessionTransition,
  clearAuthSession,
  getAuthSessionState,
  setAuthSession,
  updateAuthSessionActiveOrganization,
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
        ownerProcessStartedAt: "replacement-process-start-identity",
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

  it("does not resurrect a missing journal over a newer login", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      const transition = await beginTransitionWhoseJournalIsRemoved(home);

      await setAuthSession({
        accessToken: "new-login-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "new-login-owner" },
      });

      const commitError = await transition
        .commit()
        .catch((error: unknown) => error);
      await expect(authSessionTransitionJournalExists(home)).resolves.toBe(
        false
      );
      expect(commitError).toMatchObject({
        name: "AuthSessionTransitionConflictError",
        previousOwnerRestored: false,
        reason: "journal_missing",
      });
      await expect(getAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "new-login-token",
          user: { id: "new-login-owner" },
        },
      });
    });
  });

  it("does not resurrect a missing journal over a newer logout", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      const transition = await beginTransitionWhoseJournalIsRemoved(home);

      await clearAuthSession();

      const rollbackError = await transition
        .rollback()
        .catch((error: unknown) => error);
      await expect(authSessionTransitionJournalExists(home)).resolves.toBe(
        false
      );
      expect(rollbackError).toMatchObject({
        name: "AuthSessionTransitionConflictError",
        previousOwnerRestored: false,
        reason: "journal_missing",
      });
      await expect(getAuthSessionState()).resolves.toMatchObject({
        state: "missing",
        session: null,
      });
    });
  });

  it("does not resurrect a missing journal over a newer organization refresh", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      const transition = await beginTransitionWhoseJournalIsRemoved(home);

      await updateAuthSessionActiveOrganization({
        id: "new-organization-id",
        name: "New Organization",
        slug: "new-organization",
      });

      for (const settle of [transition.commit, transition.rollback]) {
        const settlementError = await settle().catch((error: unknown) => error);
        await expect(authSessionTransitionJournalExists(home)).resolves.toBe(
          false
        );
        expect(settlementError).toMatchObject({
          name: "AuthSessionTransitionConflictError",
          previousOwnerRestored: false,
          reason: "journal_missing",
        });
      }
      await expect(getAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          activeOrganization: {
            id: "new-organization-id",
            name: "New Organization",
            slug: "new-organization",
          },
          user: { id: "candidate-owner" },
        },
      });
    });
  });

  it("does not let a new transition claim between missing-journal recovery and previous-owner restore", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const barrierDirectory = join(home, "missing-recovery-race");
      await mkdir(barrierDirectory, { recursive: true });
      const recovering = spawnMissingJournalCommitRecovery({
        barrierDirectory,
      });
      await waitForFile(join(barrierDirectory, "recovery.restore-ready"));

      const contender = spawnClaimPausedAuthSessionTransition({
        accessToken: "next-candidate-token",
        barrierDirectory,
        userId: "next-candidate-owner",
      });
      await waitForFile(join(barrierDirectory, "contender.started"));
      const contenderClaimedBeforeRecovery = await waitForFileWithin(
        join(barrierDirectory, "contender.claim-ready"),
        1000
      );
      await writeFile(
        join(barrierDirectory, "contender.release"),
        "go\n",
        "utf8"
      );
      if (contenderClaimedBeforeRecovery) {
        await contender.result;
      }
      await writeFile(
        join(barrierDirectory, "recovery.release"),
        "go\n",
        "utf8"
      );
      const [recoveryResult, contenderResult] = await Promise.all([
        recovering.result,
        contender.result,
      ]);

      expect(contenderClaimedBeforeRecovery).toBe(false);
      expect(recoveryResult).toMatchObject({
        errorName: "AuthSessionTransitionConflictError",
        status: "error",
      });
      expect(contenderResult).toMatchObject({
        status: "success",
        userId: "next-candidate-owner",
      });

      const authDirectory = join(home, ".openmeld", "auth");
      const journal = JSON.parse(
        await readFile(join(authDirectory, "session-transition.json"), "utf8")
      ) as { candidatePayload: { user?: { id?: string } } };
      const session = JSON.parse(
        await readFile(join(authDirectory, "session.json"), "utf8")
      ) as { user?: { id?: string } };
      expect(journal.candidatePayload.user?.id).toBe("next-candidate-owner");
      expect(session.user?.id).toBe("next-candidate-owner");
      expect(
        (await readdir(join(authDirectory, "tokens"))).filter((name) =>
          name.endsWith(".token")
        )
      ).toHaveLength(2);
    });
  });

  it("does not let a service journal update replace an owned commit mutation", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const barrierDirectory = join(home, "owned-commit-race");
      await mkdir(barrierDirectory, { recursive: true });
      const committing = spawnPausedOwnedCommit({ barrierDirectory });
      await waitForFile(join(barrierDirectory, "commit.write-ready"));

      const serviceObserver = spawnServiceAuthRead({ barrierDirectory });
      await waitForFile(join(barrierDirectory, "service.started"));
      const serviceCompletedBeforeCommit = await promiseSettledWithin(
        serviceObserver.result,
        1000
      );
      await writeFile(join(barrierDirectory, "commit.release"), "go\n", "utf8");
      const [commitResult, serviceResult] = await Promise.all([
        committing.result,
        serviceObserver.result,
      ]);

      expect(serviceCompletedBeforeCommit).toBe(false);
      expect(commitResult).toMatchObject({
        status: "success",
        userId: "committing-candidate-owner",
      });
      expect(serviceResult).toMatchObject({
        status: "success",
        userId: "committing-candidate-owner",
      });
      const authDirectory = join(home, ".openmeld", "auth");
      const journal = JSON.parse(
        await readFile(join(authDirectory, "session-transition.json"), "utf8")
      ) as { state: string };
      const session = JSON.parse(
        await readFile(join(authDirectory, "session.json"), "utf8")
      ) as { user?: { id?: string } };
      expect(journal.state).toBe("committed");
      expect(session.user?.id).toBe("committing-candidate-owner");
    });
  });
});

async function beginTransitionWhoseJournalIsRemoved(home: string) {
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
  return transition;
}

async function authSessionTransitionJournalExists(
  home: string
): Promise<boolean> {
  return await access(
    join(home, ".openmeld", "auth", "session-transition.json")
  ).then(
    () => true,
    (error: unknown) =>
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
        ? false
        : Promise.reject(error)
  );
}

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
    import { setTimeout as sleep } from "node:timers/promises";

    const { beginAuthSessionTransition } = await import(${JSON.stringify(authSessionModuleUrl)});
    await fs.promises.writeFile(${JSON.stringify(readyPath)}, "ready\\n", "utf8");
    while (true) {
      const released = await fs.promises.stat(${JSON.stringify(releasePath)}).then(
        () => true,
        (error) => error?.code === "ENOENT" ? false : Promise.reject(error)
      );
      if (released) break;
      await sleep(5);
    }
    try {
      await beginAuthSessionTransition({
        accessToken: ${JSON.stringify(input.accessToken)},
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: ${JSON.stringify(input.userId)} },
      });
      // Keep the winning owner alive long enough for the losing process to
      // observe the owned journal after it acquires the mutation lock.
      await sleep(500);
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

function spawnMissingJournalCommitRecovery(input: {
  barrierDirectory: string;
}): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const { authSessionModuleUrl, tsxLoaderPath } = resolveAuthSessionFixture();
  const readyPath = join(input.barrierDirectory, "recovery.restore-ready");
  const releasePath = join(input.barrierDirectory, "recovery.release");
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import { setTimeout as sleep } from "node:timers/promises";

    const originalRename = fs.promises.rename.bind(fs.promises);
    let pausePreviousOwnerRestore = false;
    fs.promises.rename = async (...args) => {
      const target = String(args[1]);
      if (pausePreviousOwnerRestore && target.endsWith("/auth/session.json")) {
        pausePreviousOwnerRestore = false;
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
      return await originalRename(...args);
    };
    syncBuiltinESMExports();

    const { beginAuthSessionTransition } = await import(${JSON.stringify(authSessionModuleUrl)});
    const transition = await beginAuthSessionTransition({
      accessToken: "recovering-candidate-token",
      authBaseUrl: "https://auth.openmeld.invalid",
      clientId: "openmeld-cli",
      user: { id: "recovering-candidate-owner" },
    });
    await fs.promises.rm(
      join(process.env.OPENMELD_HOME, "auth", "session-transition.json"),
      { force: true }
    );
    pausePreviousOwnerRestore = true;
    try {
      await transition.commit();
      process.stdout.write(JSON.stringify({
        status: "success",
        userId: "recovering-candidate-owner",
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: "error",
        userId: "recovering-candidate-owner",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  `;
  return spawnAuthSessionFixture({ script, tsxLoaderPath });
}

function spawnClaimPausedAuthSessionTransition(input: {
  accessToken: string;
  barrierDirectory: string;
  userId: string;
}): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const { authSessionModuleUrl, tsxLoaderPath } = resolveAuthSessionFixture();
  const startedPath = join(input.barrierDirectory, "contender.started");
  const readyPath = join(input.barrierDirectory, "contender.claim-ready");
  const releasePath = join(input.barrierDirectory, "contender.release");
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { setTimeout as sleep } from "node:timers/promises";

    const originalLink = fs.promises.link.bind(fs.promises);
    let pausedAtClaim = false;
    fs.promises.link = async (...args) => {
      const target = String(args[1]);
      if (!pausedAtClaim && target.endsWith("/auth/session-transition.json")) {
        pausedAtClaim = true;
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
      return await originalLink(...args);
    };
    syncBuiltinESMExports();

    const { beginAuthSessionTransition } = await import(${JSON.stringify(authSessionModuleUrl)});
    await fs.promises.writeFile(${JSON.stringify(startedPath)}, "started\\n", "utf8");
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
  return spawnAuthSessionFixture({ script, tsxLoaderPath });
}

function resolveAuthSessionFixture(): {
  authSessionModuleUrl: string;
  tsxLoaderPath: string;
} {
  const testRequire = createRequire(import.meta.url);
  const vitestRequire = createRequire(
    testRequire.resolve("vitest/package.json")
  );
  const tsxPackagePath = vitestRequire.resolve("tsx/package.json");
  return {
    authSessionModuleUrl: new URL(
      "../src/config/auth-session.ts",
      import.meta.url
    ).href,
    tsxLoaderPath: join(tsxPackagePath, "..", "dist", "loader.mjs"),
  };
}

function spawnAuthSessionFixture(input: {
  env?: NodeJS.ProcessEnv;
  script: string;
  tsxLoaderPath: string;
}): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const child = spawn(
    process.execPath,
    [
      "--import",
      input.tsxLoaderPath,
      "--input-type=module",
      "--eval",
      input.script,
    ],
    {
      env: { ...process.env, ...input.env },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  return {
    child,
    result: readRacingAuthSessionTransitionResult(child),
  };
}

async function waitForFileWithin(
  path: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
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
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

function spawnPausedOwnedCommit(input: { barrierDirectory: string }): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const { authSessionModuleUrl, tsxLoaderPath } = resolveAuthSessionFixture();
  const readyPath = join(input.barrierDirectory, "commit.write-ready");
  const releasePath = join(input.barrierDirectory, "commit.release");
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { setTimeout as sleep } from "node:timers/promises";

    const originalRename = fs.promises.rename.bind(fs.promises);
    const originalRm = fs.promises.rm.bind(fs.promises);
    let pauseCommitWrite = false;
    let preserveCommittedJournal = false;
    fs.promises.rename = async (...args) => {
      const target = String(args[1]);
      if (pauseCommitWrite && target.endsWith("/auth/session-transition.json")) {
        pauseCommitWrite = false;
        await fs.promises.writeFile(${JSON.stringify(readyPath)}, "ready\\n", "utf8");
        while (true) {
          const released = await fs.promises.stat(${JSON.stringify(releasePath)}).then(
            () => true,
            (error) => error?.code === "ENOENT" ? false : Promise.reject(error)
          );
          if (released) break;
          await sleep(5);
        }
        const result = await originalRename(...args);
        preserveCommittedJournal = true;
        return result;
      }
      return await originalRename(...args);
    };
    fs.promises.rm = async (...args) => {
      const target = String(args[0]);
      if (preserveCommittedJournal && target.endsWith("/auth/session-transition.json")) {
        const error = new Error("fixture preserves committed journal");
        error.code = "EACCES";
        throw error;
      }
      return await originalRm(...args);
    };
    syncBuiltinESMExports();

    const { beginAuthSessionTransition } = await import(${JSON.stringify(authSessionModuleUrl)});
    const transition = await beginAuthSessionTransition({
      accessToken: "committing-candidate-token",
      authBaseUrl: "https://auth.openmeld.invalid",
      clientId: "openmeld-cli",
      user: { id: "committing-candidate-owner" },
    });
    pauseCommitWrite = true;
    try {
      await transition.commit();
      process.stdout.write(JSON.stringify({
        status: "success",
        userId: "committing-candidate-owner",
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: "error",
        userId: "committing-candidate-owner",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  `;
  return spawnAuthSessionFixture({ script, tsxLoaderPath });
}

function spawnServiceAuthRead(input: { barrierDirectory: string }): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const { authSessionModuleUrl, tsxLoaderPath } = resolveAuthSessionFixture();
  const startedPath = join(input.barrierDirectory, "service.started");
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";

    const originalRm = fs.promises.rm.bind(fs.promises);
    fs.promises.rm = async (...args) => {
      const target = String(args[0]);
      if (target.endsWith("/auth/session-transition.json")) {
        const error = new Error("fixture preserves committed journal");
        error.code = "EACCES";
        throw error;
      }
      return await originalRm(...args);
    };
    syncBuiltinESMExports();

    const { getAuthSessionState } = await import(${JSON.stringify(authSessionModuleUrl)});
    await fs.promises.writeFile(${JSON.stringify(startedPath)}, "started\\n", "utf8");
    try {
      const auth = await getAuthSessionState();
      process.stdout.write(JSON.stringify({
        status: "success",
        userId: auth.session?.user?.id ?? "",
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        status: "error",
        userId: "",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  `;
  return spawnAuthSessionFixture({
    env: { OPENMELD_DAEMON_RUNTIME_MODE: "background" },
    script,
    tsxLoaderPath,
  });
}

async function promiseSettledWithin(
  promise: Promise<unknown>,
  timeoutMs: number
): Promise<boolean> {
  const unsettled = Symbol("unsettled");
  const result = await Promise.race([
    promise.then(() => true),
    new Promise<typeof unsettled>((resolve) =>
      setTimeout(() => resolve(unsettled), timeoutMs)
    ),
  ]);
  return result !== unsettled;
}

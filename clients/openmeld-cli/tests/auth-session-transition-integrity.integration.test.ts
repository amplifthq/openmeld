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
import { createServer, type ServerResponse } from "node:http";
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

const BEARER_PREFIX_PATTERN = /^Bearer /u;

describe("auth session transition integrity", () => {
  it.each([
    "completed",
    "not_completed",
    "abandoned",
    "legacy_rollback",
  ] as const)("preserves an interrupted setup and settles %s with one worker", async (outcome) => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const { authSessionModuleUrl, tsxLoaderPath } =
        resolveAuthSessionFixture();
      const creator = spawnAuthSessionFixture({
        tsxLoaderPath,
        script: `
        const { beginAuthSessionTransition } = await import(${JSON.stringify(authSessionModuleUrl)});
        await beginAuthSessionTransition({ accessToken: "candidate-token", authBaseUrl: "https://auth.openmeld.invalid", clientId: "openmeld-cli", user: { id: "candidate-owner" } }, {
          computerHandoff: { gatewayUrl: "https://gateway.openmeld.invalid", prepareContinuation: { prepareSessionId: "same-prepare-session" } }
        });
        process.stdout.write(JSON.stringify({ status: "success", userId: "candidate-owner" }));
      `,
      });
      expect((await creator.result).status).toBe("success");
      // An ordinary reader must preserve the committed account and the pending
      // intent; it must neither adopt the candidate nor roll the setup back.
      expect((await spawnOrdinaryAuthSessionRead().result).userId).toBe(
        "previous-owner"
      );
      if (outcome === "abandoned") {
        const recovery = spawnAuthSessionFixture({
          tsxLoaderPath,
          script: `
            const { getInterruptedComputerAuthSessionRecovery } = await import(${JSON.stringify(authSessionModuleUrl)});
            const recovery = await getInterruptedComputerAuthSessionRecovery();
            process.stdout.write(JSON.stringify({ status: "success", userId: recovery?.previousOwnerUserId }));
          `,
        });
        expect((await recovery.result).userId).toBe("previous-owner");
        expect((await spawnOrdinaryAuthSessionRead().result).userId).toBe(
          "previous-owner"
        );
        return;
      }
      if (outcome === "legacy_rollback") {
        // Captured legacy behavior: the old auth reader preserves unknown
        // fields but marks a dead Terminal recovery_required (Piper .5 smoke).
        const journalPath = join(
          home,
          ".openmeld",
          "auth",
          "session-transition.json"
        );
        const journal = JSON.parse(await readFile(journalPath, "utf8"));
        await writeFile(
          journalPath,
          JSON.stringify({
            ...journal,
            state: "recovery_required",
          })
        );
      }
      const finalOutcome =
        outcome === "legacy_rollback" ? "completed" : outcome;
      const executionsPath = join(home, "setup-executions");
      // A worker can also disappear after taking ownership. The next process
      // must adopt the same journal instead of leaving setup stuck forever.
      const interruptedWorker = spawnAuthSessionFixture({
        tsxLoaderPath,
        script: `
          const { resumeInterruptedComputerSetup } = await import(${JSON.stringify(authSessionModuleUrl)});
          await resumeInterruptedComputerSetup(async () => {
            process.stdout.write(JSON.stringify({ status: "success", userId: "interrupted-worker" }));
            process.exit(0);
          });
        `,
      });
      expect((await interruptedWorker.result).userId).toBe(
        "interrupted-worker"
      );
      const workerScript = `
        import { appendFile } from "node:fs/promises";
        const { resumeInterruptedComputerSetup, getAuthSessionState } = await import(${JSON.stringify(authSessionModuleUrl)});
        const resumed = await resumeInterruptedComputerSetup(async intent => {
          if (intent.prepareSessionId !== "same-prepare-session") throw new Error("wrong session");
          const auth = await getAuthSessionState({ validateRemote: false });
          if (auth.session?.user?.id !== "candidate-owner") throw new Error("wrong account");
          await appendFile(${JSON.stringify(executionsPath)}, "completed\\n");
          return ${JSON.stringify(finalOutcome)};
        });
        process.stdout.write(JSON.stringify({ status: "success", userId: resumed ? "resumed" : "idle" }));
      `;
      const results = await Promise.all([
        spawnAuthSessionFixture({ script: workerScript, tsxLoaderPath }).result,
        spawnAuthSessionFixture({ script: workerScript, tsxLoaderPath }).result,
      ]);
      expect(results.map((result) => result.userId).sort()).toEqual([
        "idle",
        "resumed",
      ]);
      expect(await readFile(executionsPath, "utf8")).toBe("completed\n");
      expect((await spawnOrdinaryAuthSessionRead().result).userId).toBe(
        finalOutcome === "completed" ? "candidate-owner" : "previous-owner"
      );
      expect(await authSessionTransitionJournalExists(home)).toBe(
        finalOutcome !== "completed"
      );
    });
  });
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
      expect(session.user?.id).toBe("previous-owner");
      expect(
        (await readdir(join(authDirectory, "tokens"))).filter((name) =>
          name.endsWith(".token")
        )
      ).toHaveLength(2);
    });
  });

  it("rejects a confirmed account switch when another process changes the committed session", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "confirmed-previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "confirmed-previous-owner" },
      });
      const confirmedState = await getAuthSessionState({
        validateRemote: false,
      });
      expect(confirmedState).toMatchObject({
        state: "valid",
        session: { user: { id: "confirmed-previous-owner" } },
      });

      const replacement = spawnCommittedAuthSessionReplacement({
        accessToken: "intervening-token",
        userId: "intervening-owner",
      });
      await expect(replacement.result).resolves.toMatchObject({
        status: "success",
        userId: "intervening-owner",
      });

      await expect(
        beginAuthSessionTransition(
          {
            accessToken: "candidate-token",
            authBaseUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            user: { id: "candidate-owner" },
          },
          { expectedPreviousSession: confirmedState.session }
        )
      ).rejects.toMatchObject({
        name: "AuthSessionChangedBeforeTransitionError",
        reason: "previous_session_changed",
      });
      await expect(getAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "intervening-token",
          user: { id: "intervening-owner" },
        },
      });
      await expect(readStoredTokenInventory(home)).resolves.toEqual([
        "intervening-token",
      ]);
    });
  });

  it("keeps a candidate session private until commit while its Service uses it", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const confirmedState = await getAuthSessionState({
        validateRemote: false,
      });
      const transition = await beginAuthSessionTransition(
        {
          accessToken: "candidate-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "candidate-owner" },
        },
        { expectedPreviousSession: confirmedState.session }
      );

      await expect(getAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "candidate-token",
          user: { id: "candidate-owner" },
        },
      });
      await expect(
        spawnOrdinaryAuthSessionRead().result
      ).resolves.toMatchObject({
        status: "success",
        userId: "previous-owner",
      });
      await expect(
        spawnCandidateServiceAuthSessionRead().result
      ).resolves.toMatchObject({
        status: "success",
        userId: "candidate-owner",
      });
      const canonicalBeforeCommit = JSON.parse(
        await readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ) as { user?: { id?: string } };
      expect(canonicalBeforeCommit.user?.id).toBe("previous-owner");

      await transition.commit();

      await expect(
        spawnOrdinaryAuthSessionRead().result
      ).resolves.toMatchObject({
        status: "success",
        userId: "candidate-owner",
      });
      await expect(readStoredTokenInventory(home)).resolves.toEqual([
        "candidate-token",
      ]);
    });
  });

  it("keeps the candidate visible to overlapping Service startup attempts", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      await beginAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "candidate-owner" },
      });

      const barrierDirectory = join(home, "candidate-service-read-barrier");
      await mkdir(barrierDirectory, { recursive: true });
      const first = spawnPausedCandidateServiceAuthSessionRead({
        barrierDirectory,
      });
      await waitForFile(join(barrierDirectory, "first.ready"));

      await expect(
        spawnCandidateServiceAuthSessionRead().result
      ).resolves.toMatchObject({
        status: "success",
        userId: "candidate-owner",
      });
      await writeFile(join(barrierDirectory, "first.release"), "go\n", "utf8");

      await expect(first.result).resolves.toMatchObject({
        status: "success",
        userId: "candidate-owner",
      });
    });
  });

  it("keeps a rotated candidate usable for later Service reads and commit", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      let originalCandidateValidationCount = 0;
      const server = createServer((request, response) => {
        const authorization = request.headers.authorization;
        if (authorization === "Bearer candidate-token") {
          originalCandidateValidationCount += 1;
          if (originalCandidateValidationCount > 1) {
            response.writeHead(401).end();
            return;
          }
        } else if (authorization !== "Bearer candidate-token-refreshed") {
          response.writeHead(401).end();
          return;
        }
        response.writeHead(200, {
          "content-type": "application/json",
          ...(authorization === "Bearer candidate-token"
            ? { "set-auth-token": "candidate-token-refreshed" }
            : {}),
        });
        response.end(
          JSON.stringify({
            session: {
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              id: "candidate-session",
            },
            user: { id: "candidate-owner" },
          })
        );
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!(address && typeof address === "object")) {
          throw new Error("candidate auth fixture did not bind a local port");
        }
        const authBaseUrl = `http://127.0.0.1:${String(address.port)}`;
        await setAuthSession({
          accessToken: "previous-token",
          authBaseUrl,
          clientId: "openmeld-cli",
          user: { id: "previous-owner" },
        });
        const transition = await beginAuthSessionTransition({
          accessToken: "candidate-token",
          authBaseUrl,
          clientId: "openmeld-cli",
          user: { id: "candidate-owner" },
        });

        await expect(
          spawnCandidateServiceAuthSessionRead({ validateRemote: true }).result
        ).resolves.toMatchObject({
          accessToken: "candidate-token-refreshed",
          status: "success",
          state: "valid",
          userId: "candidate-owner",
        });
        await expect(
          spawnCandidateServiceAuthSessionRead({ validateRemote: true }).result
        ).resolves.toMatchObject({
          accessToken: "candidate-token-refreshed",
          status: "success",
          state: "valid",
          userId: "candidate-owner",
        });

        await transition.commit();

        await expect(
          spawnOrdinaryAuthSessionRead().result
        ).resolves.toMatchObject({
          accessToken: "candidate-token-refreshed",
          status: "success",
          state: "valid",
          userId: "candidate-owner",
        });
        await expect(readStoredTokenInventory(home)).resolves.toEqual([
          "candidate-token-refreshed",
        ]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });
  });

  it("serializes overlapping candidate Service token rotations", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      let pendingOriginalTokenResponse: ((accessToken: string) => void) | null =
        null;
      let originalTokenFallback: NodeJS.Timeout | null = null;
      let currentAccessToken = "candidate-token";
      const respondWithSession = (
        response: ServerResponse,
        accessToken: string,
        nextAccessToken?: string
      ) => {
        currentAccessToken = nextAccessToken ?? accessToken;
        response.writeHead(200, {
          "content-type": "application/json",
          ...(nextAccessToken ? { "set-auth-token": nextAccessToken } : {}),
        });
        response.end(
          JSON.stringify({
            session: {
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              id: "candidate-session",
            },
            user: { id: "candidate-owner" },
          })
        );
      };
      const server = createServer((request, response) => {
        const accessToken = request.headers.authorization?.replace(
          BEARER_PREFIX_PATTERN,
          ""
        );
        if (accessToken === "candidate-token") {
          if (!pendingOriginalTokenResponse) {
            pendingOriginalTokenResponse = (nextAccessToken) =>
              respondWithSession(response, "candidate-token", nextAccessToken);
            originalTokenFallback = setTimeout(() => {
              pendingOriginalTokenResponse?.("candidate-token-1");
              pendingOriginalTokenResponse = null;
            }, 200);
            return;
          }
          const respondToFirstRequest = pendingOriginalTokenResponse;
          pendingOriginalTokenResponse = null;
          if (originalTokenFallback) {
            clearTimeout(originalTokenFallback);
            originalTokenFallback = null;
          }
          respondToFirstRequest("candidate-token-1");
          setTimeout(() => {
            respondWithSession(
              response,
              "candidate-token",
              "candidate-token-2"
            );
          }, 1000);
          return;
        }
        if (
          accessToken === "candidate-token-1" &&
          currentAccessToken === "candidate-token-1"
        ) {
          respondWithSession(
            response,
            "candidate-token-1",
            "candidate-token-2"
          );
          return;
        }
        if (accessToken === currentAccessToken) {
          respondWithSession(response, currentAccessToken);
          return;
        }
        response.writeHead(401).end();
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!(address && typeof address === "object")) {
          throw new Error("candidate auth fixture did not bind a local port");
        }
        const authBaseUrl = `http://127.0.0.1:${String(address.port)}`;
        await setAuthSession({
          accessToken: "previous-token",
          authBaseUrl,
          clientId: "openmeld-cli",
          user: { id: "previous-owner" },
        });
        const transition = await beginAuthSessionTransition({
          accessToken: "candidate-token",
          authBaseUrl,
          clientId: "openmeld-cli",
          user: { id: "candidate-owner" },
        });

        const first = spawnCandidateServiceAuthSessionRead({
          validateRemote: true,
        });
        const second = spawnCandidateServiceAuthSessionRead({
          validateRemote: true,
        });
        await expect(
          Promise.all([first.result, second.result])
        ).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              status: "success",
              userId: "candidate-owner",
            }),
            expect.objectContaining({
              status: "success",
              userId: "candidate-owner",
            }),
          ])
        );
        await expect(
          spawnCandidateServiceAuthSessionRead({ validateRemote: true }).result
        ).resolves.toMatchObject({
          accessToken: "candidate-token-2",
          state: "valid",
          status: "success",
          userId: "candidate-owner",
        });

        await transition.commit();

        await expect(
          spawnOrdinaryAuthSessionRead().result
        ).resolves.toMatchObject({
          accessToken: "candidate-token-2",
          state: "valid",
          status: "success",
          userId: "candidate-owner",
        });
        await expect(readStoredTokenInventory(home)).resolves.toEqual([
          "candidate-token-2",
        ]);
      } finally {
        if (originalTokenFallback) {
          clearTimeout(originalTokenFallback);
        }
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });
  });

  it("restores the previous owner when a rotated candidate commit cannot finish its journal write", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      const server = createServer((request, response) => {
        if (request.headers.authorization !== "Bearer candidate-token") {
          response.writeHead(401).end();
          return;
        }
        response.writeHead(200, {
          "content-type": "application/json",
          "set-auth-token": "candidate-token-refreshed",
        });
        response.end(
          JSON.stringify({
            session: {
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              id: "candidate-session",
            },
            user: { id: "candidate-owner" },
          })
        );
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!(address && typeof address === "object")) {
          throw new Error("candidate auth fixture did not bind a local port");
        }
        const authBaseUrl = `http://127.0.0.1:${String(address.port)}`;
        await setAuthSession({
          accessToken: "previous-token",
          authBaseUrl,
          clientId: "openmeld-cli",
          user: { id: "previous-owner" },
        });

        await expect(
          spawnRotatedCandidateCommitFailureRollback({ authBaseUrl }).result
        ).resolves.toMatchObject({
          commitErrorMessage: "fixture rejects committed journal write",
          rollbackStatus: "success",
          state: "valid",
          status: "success",
          userId: "previous-owner",
        });
        await expect(readStoredTokenInventory(home)).resolves.toEqual([
          "previous-token",
        ]);
        await expect(authSessionTransitionJournalExists(home)).resolves.toBe(
          false
        );
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });
  });

  it("restores the previous owner and removes every rotated candidate token on rollback", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      const server = createServer((request, response) => {
        if (request.headers.authorization !== "Bearer candidate-token") {
          response.writeHead(401).end();
          return;
        }
        response.writeHead(200, {
          "content-type": "application/json",
          "set-auth-token": "candidate-token-refreshed",
        });
        response.end(
          JSON.stringify({
            session: {
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              id: "candidate-session",
            },
            user: { id: "candidate-owner" },
          })
        );
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!(address && typeof address === "object")) {
          throw new Error("candidate auth fixture did not bind a local port");
        }
        const authBaseUrl = `http://127.0.0.1:${String(address.port)}`;
        await setAuthSession({
          accessToken: "previous-token",
          authBaseUrl,
          clientId: "openmeld-cli",
          user: { id: "previous-owner" },
        });
        const transition = await beginAuthSessionTransition({
          accessToken: "candidate-token",
          authBaseUrl,
          clientId: "openmeld-cli",
          user: { id: "candidate-owner" },
        });

        await expect(
          spawnCandidateServiceAuthSessionRead({ validateRemote: true }).result
        ).resolves.toMatchObject({
          accessToken: "candidate-token-refreshed",
          status: "success",
          state: "valid",
          userId: "candidate-owner",
        });

        await transition.rollback();

        await expect(
          spawnOrdinaryAuthSessionRead().result
        ).resolves.toMatchObject({
          accessToken: "previous-token",
          status: "success",
          state: "valid",
          userId: "previous-owner",
        });
        await expect(readStoredTokenInventory(home)).resolves.toEqual([
          "previous-token",
        ]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
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
      expect(currentPayload.user?.id).toBe("previous-owner");
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
      await expect(readStoredTokenInventory(home)).resolves.toEqual([
        "new-login-token",
      ]);
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
      await expect(readStoredTokenInventory(home)).resolves.toEqual([]);
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
          user: { id: "previous-owner" },
        },
      });
      await expect(readStoredTokenInventory(home)).resolves.toEqual([
        "previous-token",
      ]);
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
      expect(session.user?.id).toBe("previous-owner");
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

async function readStoredTokenInventory(home: string): Promise<string[]> {
  const tokensDirectory = join(home, ".openmeld", "auth", "tokens");
  const entries = await readdir(tokensDirectory).catch((error: unknown) =>
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
      ? []
      : Promise.reject(error)
  );
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".token"))
        .map(async (entry) =>
          (await readFile(join(tokensDirectory, entry), "utf8")).trim()
        )
    )
  ).sort();
}

type RacingAuthSessionTransitionResult = {
  accessToken?: string;
  errorMessage?: string;
  errorName?: string;
  state?: string;
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

function spawnCommittedAuthSessionReplacement(input: {
  accessToken: string;
  userId: string;
}): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const { authSessionModuleUrl, tsxLoaderPath } = resolveAuthSessionFixture();
  const script = `
    const { setAuthSession } = await import(${JSON.stringify(authSessionModuleUrl)});
    try {
      await setAuthSession({
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

function spawnOrdinaryAuthSessionRead(): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  return spawnAuthSessionRead();
}

function spawnCandidateServiceAuthSessionRead(
  input: { validateRemote?: boolean } = {}
): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  return spawnAuthSessionRead({
    runtimeMode: "background",
    validateRemote: input.validateRemote,
  });
}

function spawnPausedCandidateServiceAuthSessionRead(input: {
  barrierDirectory: string;
}): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const { authSessionModuleUrl, tsxLoaderPath } = resolveAuthSessionFixture();
  const readyPath = join(input.barrierDirectory, "first.ready");
  const releasePath = join(input.barrierDirectory, "first.release");
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { setTimeout as sleep } from "node:timers/promises";

    const originalReadFile = fs.promises.readFile.bind(fs.promises);
    const originalRmdir = fs.promises.rmdir.bind(fs.promises);
    let paused = false;
    fs.promises.rmdir = async (...args) => {
      const result = await originalRmdir(...args);
      const target = String(args[0]);
      if (!paused && target.endsWith("/auth-session/session-transition-mutation.lock")) {
        // Pause after registration releases ownership, not at a numbered read.
        paused = true;
        await fs.promises.writeFile(${JSON.stringify(readyPath)}, "ready\\n", "utf8");
        while (true) {
          const released = await originalReadFile(${JSON.stringify(releasePath)}, "utf8").then(
            () => true,
            (error) => error?.code === "ENOENT" ? false : Promise.reject(error)
          );
          if (released) {
            break;
          }
          await sleep(10);
        }
      }
      return result;
    };
    syncBuiltinESMExports();

    const { getAuthSessionState } = await import(${JSON.stringify(authSessionModuleUrl)});
    try {
      const auth = await getAuthSessionState({ validateRemote: false });
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

function spawnAuthSessionRead(
  input: {
    preserveTransitionJournal?: boolean;
    runtimeMode?: "background";
    startedPath?: string;
    validateRemote?: boolean;
  } = {}
): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const { authSessionModuleUrl, tsxLoaderPath } = resolveAuthSessionFixture();
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";

    ${
      input.preserveTransitionJournal
        ? `const originalRm = fs.promises.rm.bind(fs.promises);
    fs.promises.rm = async (...args) => {
      const target = String(args[0]);
      if (target.endsWith("/auth/session-transition.json")) {
        const error = new Error("fixture preserves committed journal");
        error.code = "EACCES";
        throw error;
      }
      return await originalRm(...args);
    };
    syncBuiltinESMExports();`
        : ""
    }

    const { getAuthSessionState } = await import(${JSON.stringify(authSessionModuleUrl)});
    ${input.startedPath ? `await fs.promises.writeFile(${JSON.stringify(input.startedPath)}, "started\\n", "utf8");` : ""}
    try {
      const auth = await getAuthSessionState({ validateRemote: ${String(input.validateRemote === true)} });
      process.stdout.write(JSON.stringify({
        accessToken: auth.session?.accessToken ?? "",
        status: "success",
        state: auth.state,
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
    env: input.runtimeMode
      ? { OPENMELD_DAEMON_RUNTIME_MODE: input.runtimeMode }
      : undefined,
    script,
    tsxLoaderPath,
  });
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

function spawnRotatedCandidateCommitFailureRollback(input: {
  authBaseUrl: string;
}): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const { authSessionModuleUrl, tsxLoaderPath } = resolveAuthSessionFixture();
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";

    const {
      beginAuthSessionTransition,
      getAuthSessionState,
    } = await import(${JSON.stringify(authSessionModuleUrl)});
    const transition = await beginAuthSessionTransition({
      accessToken: "candidate-token",
      authBaseUrl: ${JSON.stringify(input.authBaseUrl)},
      clientId: "openmeld-cli",
      user: { id: "candidate-owner" },
    });
    await getAuthSessionState({ validateRemote: true });

    const originalRename = fs.promises.rename.bind(fs.promises);
    let rejectCommittedJournalWrite = true;
    fs.promises.rename = async (...args) => {
      const target = String(args[1]);
      if (
        rejectCommittedJournalWrite &&
        target.endsWith("/auth/session-transition.json")
      ) {
        rejectCommittedJournalWrite = false;
        throw new Error("fixture rejects committed journal write");
      }
      return await originalRename(...args);
    };
    syncBuiltinESMExports();

    let commitErrorMessage = "";
    try {
      await transition.commit();
    } catch (error) {
      commitErrorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      fs.promises.rename = originalRename;
      syncBuiltinESMExports();
    }

    let rollbackStatus = "success";
    let rollbackErrorMessage = "";
    try {
      await transition.rollback();
    } catch (error) {
      rollbackStatus = "error";
      rollbackErrorMessage = error instanceof Error ? error.message : String(error);
    }
    const auth = await getAuthSessionState({ validateRemote: false });
    process.stdout.write(JSON.stringify({
      commitErrorMessage,
      rollbackErrorMessage,
      rollbackStatus,
      status: "success",
      state: auth.state,
      userId: auth.session?.user?.id ?? "",
    }));
  `;
  return spawnAuthSessionFixture({ script, tsxLoaderPath });
}

function spawnServiceAuthRead(input: { barrierDirectory: string }): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<RacingAuthSessionTransitionResult>;
} {
  const startedPath = join(input.barrierDirectory, "service.started");
  return spawnAuthSessionRead({
    preserveTransitionJournal: true,
    runtimeMode: "background",
    startedPath,
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

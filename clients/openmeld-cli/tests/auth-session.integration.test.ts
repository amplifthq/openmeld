import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginAuthSessionTransition,
  clearAuthSession,
  getAuthSession,
  getAuthSessionState,
  readActiveOrganizationIdFromSessionPayload,
  setAuthSession,
  updateAuthSessionActiveOrganization,
} from "../src/config/auth-session";
import { acquireLock, releaseLock } from "../src/config/lock";
import { withTempHome } from "./helpers/fs";

const LINE_BREAK_RE = /\r?\n/u;

describe("auth session storage", () => {
  it("clears only the reviewed Computer session, preserving a concurrent account replacement", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      const base = {
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      };
      await setAuthSession({
        ...base,
        accessToken: "account-a-token",
        user: { id: "account-a" },
      });
      const reviewed = await getAuthSession();
      if (!reviewed) {
        throw new Error("Missing fixture session");
      }
      await setAuthSession({
        ...base,
        accessToken: "account-b-token",
        user: { id: "account-b" },
      });
      await expect(clearAuthSession(reviewed)).rejects.toThrow();
      const replacement = await getAuthSession();
      expect(replacement?.user?.id).toBe("account-b");
      if (!replacement) {
        throw new Error("Replacement was lost");
      }
      await clearAuthSession(replacement);
      expect(await getAuthSession()).toBeNull();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
  });

  it("reads the committed session during an unrelated mutation when no transition needs recovery", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "committed-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "committed-owner" },
      });
      const lock = await acquireLock({
        openMeldProfileId: "auth-session",
        key: "session-transition-mutation",
      });
      const reading = getAuthSession();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          reading,
          new Promise<"blocked">((resolve) => {
            timer = setTimeout(() => resolve("blocked"), 2000);
          }),
        ]);
        expect(result).toMatchObject({
          accessToken: "committed-token",
          user: { id: "committed-owner" },
        });
      } finally {
        clearTimeout(timer);
        await releaseLock(lock);
        await reading;
      }
    });
  });

  it("persists and loads auth session", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-123",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: "2026-12-31T00:00:00.000Z",
        scope: "openid profile email",
        user: {
          id: "user_123",
          email: "you@company.com",
          name: "Felix",
        },
        activeOrganization: {
          id: "org_123",
          slug: "acme",
          name: "Acme",
          role: "owner",
        },
      });

      const session = await getAuthSession();
      expect(session).not.toBeNull();
      expect(session?.accessToken).toBe("token-123");
      expect(session?.v).toBe(1);
      expect(session?.tokenType).toBe("Bearer");
      expect(session?.authBaseUrl).toBe("https://auth.openmeld.invalid");
      expect(session?.clientId).toBe("openmeld-cli");
      expect(session?.expiresAt).toBe("2026-12-31T00:00:00.000Z");
      expect(session?.scope).toBe("openid profile email");
      expect(session?.user?.id).toBe("user_123");
      expect(session?.user?.email).toBe("you@company.com");
      expect(session?.user?.name).toBe("Felix");
      expect(session?.activeOrganization).toEqual({
        id: "org_123",
        slug: "acme",
        name: "Acme",
        role: "owner",
      });

      const raw = await readFile(
        join(home, ".openmeld", "auth", "session.json"),
        "utf8"
      );
      expect(raw).not.toContain("token-123");
      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reuses a loaded token while the persisted session is unchanged", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-cached",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const sessionPath = join(home, ".openmeld", "auth", "session.json");
      const payload = JSON.parse(await readFile(sessionPath, "utf8")) as {
        tokenRef: { key: string };
      };
      await rm(
        join(
          home,
          ".openmeld",
          "auth",
          "tokens",
          `${payload.tokenRef.key}.token`
        )
      );

      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "token-cached",
      });

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reloads a valid session after the OpenMeld process restarts", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-after-restart",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "user-after-restart" },
      });

      vi.resetModules();
      const { getAuthSession: getRestartedAuthSession } = await import(
        "../src/config/auth-session"
      );

      await expect(getRestartedAuthSession()).resolves.toMatchObject({
        accessToken: "token-after-restart",
        user: { id: "user-after-restart" },
      });
      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("recovers the previous session after a setup process crashes before commit", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "candidate-owner" },
      });
      const transitionPath = join(
        home,
        ".openmeld",
        "auth",
        "session-transition.json"
      );

      vi.resetModules();
      const { getAuthSessionState: getRestartedAuthSessionState } =
        await import("../src/config/auth-session");

      await expect(getRestartedAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "previous-token",
          user: { id: "previous-owner" },
        },
      });
      await expect(readFile(transitionPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("stops the candidate service process before a restarted service reads the recovered owner", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const candidateServicePid = await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        startCandidateService: true,
        user: { id: "candidate-owner" },
      });

      try {
        vi.resetModules();
        const { getAuthSessionState: getRestartedAuthSessionState } =
          await import("../src/config/auth-session");

        await expect(getRestartedAuthSessionState()).resolves.toMatchObject({
          state: "valid",
          session: {
            accessToken: "previous-token",
            user: { id: "previous-owner" },
          },
        });
        await waitForProcessExit(candidateServicePid);
        await expect(readOwnerFromRestartedServiceProcess()).resolves.toBe(
          "previous-owner"
        );
      } finally {
        stopProcessIfAlive(candidateServicePid);
      }
    });
  });

  it("keeps crash recovery durable until the candidate remote session is revoked", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });

      vi.resetModules();
      const restartedAuthSession = await import("../src/config/auth-session");
      const recovery =
        await restartedAuthSession.getInterruptedComputerAuthSessionRecovery();

      expect(recovery).toMatchObject({
        candidateSession: {
          accessToken: "candidate-token",
          user: { id: "candidate-owner" },
        },
        previousOwnerUserId: "previous-owner",
        remoteSessionRevoked: false,
        serviceReconciled: false,
      });
      await expect(
        readFile(
          join(home, ".openmeld", "auth", "session-transition.json"),
          "utf8"
        )
      ).resolves.toContain('"state": "recovery_required"');

      await restartedAuthSession.markInterruptedComputerAuthSessionRecovery({
        id: recovery?.id ?? "",
        phase: "service",
      });
      await restartedAuthSession.markInterruptedComputerAuthSessionRecovery({
        id: recovery?.id ?? "",
        phase: "remote_session",
      });
      await expect(
        restartedAuthSession.completeInterruptedComputerAuthSessionRecovery(
          recovery?.id ?? ""
        )
      ).resolves.toBe(true);
      await expect(
        restartedAuthSession.getAuthSessionState()
      ).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "previous-token",
          user: { id: "previous-owner" },
        },
      });
      await expect(
        readFile(
          join(home, ".openmeld", "auth", "session-transition.json"),
          "utf8"
        )
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("lets an explicit sign-in finish recovery when the previous sign-in expired, without restarting a Service", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: "2026-01-01T00:00:00.000Z",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });

      // Responses captured from the real Auth Worker (better-auth 1.6.30):
      // get-session for an expired or deleted session is 200 `null`, and
      // sign-out with an unknown, expired, or deleted bearer is 200 success.
      const authRequests: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string | URL, init?: RequestInit) => {
          const authorization = new Headers(init?.headers).get("authorization");
          const pathname = new URL(String(url)).pathname;
          authRequests.push(`${pathname} ${String(authorization)}`);
          const body =
            pathname === "/api/auth/sign-out" ? { success: true } : null;
          return Promise.resolve(
            new Response(JSON.stringify(body), {
              headers: { "content-type": "application/json" },
              status: 200,
            })
          );
        })
      );
      const stopService = vi.fn(() => Promise.resolve({ status: "stopped" }));
      // An expired previous sign-in can never align its Service.
      const restoreService = vi.fn(() =>
        Promise.resolve({
          errorMessage: "OpenMeld could not finish starting OpenMeld Service.",
          status: "needs_attention",
        })
      );
      const serviceModuleMocks = {
        "../src/commands/service": () => ({
          bestEffortStopCurrentLaneDaemonService: stopService,
        }),
        "../src/system/local-service-participation-gate": () => ({
          runDaemonServiceParticipationGate: restoreService,
        }),
        "../src/local-service/lifecycle/daemon-service-update-state": () => ({
          readPendingDaemonServiceUpdate: () => Promise.resolve(null),
        }),
        "../src/local-service/maintenance/openmeld-tools-update-attempt-state":
          () => ({
            readPendingOpenMeldToolsUpdateAttempt: () => Promise.resolve(null),
          }),
        "../src/local-service/maintenance/openmeld-tools-update-join": () => ({
          resolveExternalOpenMeldToolsUpdate: () => Promise.resolve(null),
          waitForExternalOpenMeldToolsUpdate: () => Promise.resolve(),
        }),
      };
      vi.resetModules();
      for (const [path, factory] of Object.entries(serviceModuleMocks)) {
        vi.doMock(path, factory);
      }
      try {
        const restartedAuthSession = await import("../src/config/auth-session");
        const { finishInterruptedComputerAuthHandoffBeforeAccountChange } =
          await import("../src/commands/computer-auth-handoff-recovery");

        await expect(
          restartedAuthSession.assertAuthSessionMutationAvailable()
        ).rejects.toMatchObject({
          name: "AuthSessionRecoveryInProgressError",
          message: expect.stringContaining("openmeld login"),
        });

        await finishInterruptedComputerAuthHandoffBeforeAccountChange({
          presenter: {
            data: vi.fn(),
            event: vi.fn(),
            line: vi.fn(),
            view: "agent",
          },
          runtime: {
            interactive: false,
            resolvedView: "agent",
            viewMode: "agent",
          },
        });

        expect(stopService).toHaveBeenCalledTimes(1);
        expect(restoreService).not.toHaveBeenCalled();
        expect(authRequests).toEqual([
          "/api/auth/get-session Bearer previous-token",
          "/api/auth/sign-out Bearer candidate-token",
        ]);
        await expect(
          readFile(
            join(home, ".openmeld", "auth", "session-transition.json"),
            "utf8"
          )
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          restartedAuthSession.getAuthSessionMetadata()
        ).resolves.toMatchObject({ user: { id: "previous-owner" } });

        await restartedAuthSession.assertAuthSessionMutationAvailable();
        await restartedAuthSession.setAuthSession({
          accessToken: "replacement-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "replacement-owner" },
        });
        await expect(
          restartedAuthSession.getAuthSession()
        ).resolves.toMatchObject({
          accessToken: "replacement-token",
          user: { id: "replacement-owner" },
        });
      } finally {
        for (const path of Object.keys(serviceModuleMocks)) {
          vi.doUnmock(path);
        }
      }
    });
  });

  it("persists a server-confirmed renewal, including a rotated token, of the restored previous sign-in during recovery", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: "2026-01-01T00:00:00.000Z",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });
      // Shape captured from the real Auth Worker get-session response.
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                session: {
                  expiresAt: "2099-01-01T00:00:00.000Z",
                  id: "previous-session",
                  token: "previous-token",
                  userId: "previous-owner",
                },
                user: { email: "previous@example.com", id: "previous-owner" },
              }),
              {
                headers: {
                  "content-type": "application/json",
                  "set-auth-token": "rotated-previous-token",
                },
                status: 200,
              }
            )
          )
        )
      );

      vi.resetModules();
      const restartedAuthSession = await import("../src/config/auth-session");
      await restartedAuthSession.getInterruptedComputerAuthSessionRecovery();
      await expect(
        restartedAuthSession.getAuthSessionState({
          refreshExpired: true,
          validateRemote: true,
        })
      ).resolves.toMatchObject({
        state: "valid",
        session: { expiresAt: "2099-01-01T00:00:00.000Z" },
      });

      // OpenMeld Service startup reads the committed sign-in locally only.
      vi.resetModules();
      const serviceProcess = await import("../src/config/auth-session");
      await expect(
        serviceProcess.getAuthSessionState({ validateRemote: false })
      ).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "rotated-previous-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
          user: { id: "previous-owner" },
        },
      });
      const journal = JSON.parse(
        await readFile(
          join(home, ".openmeld", "auth", "session-transition.json"),
          "utf8"
        )
      ) as {
        previousPayload: { expiresAt?: string; tokenRef: unknown };
        state: string;
      };
      const committed = JSON.parse(
        await readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ) as { tokenRef: unknown };
      expect(journal.previousPayload.tokenRef).toEqual(committed.tokenRef);
      expect(journal).toMatchObject({
        previousPayload: { expiresAt: "2099-01-01T00:00:00.000Z" },
        state: "recovery_required",
      });
      await expect(
        serviceProcess.getInterruptedComputerAuthSessionRecovery()
      ).resolves.toMatchObject({
        previousOwnerUserId: "previous-owner",
      });
    });
  });

  it("releases the replaced previous token when the journal update fails during a renewal", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: "2026-01-01T00:00:00.000Z",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                session: {
                  expiresAt: "2099-01-01T00:00:00.000Z",
                  id: "previous-session",
                  token: "previous-token",
                  userId: "previous-owner",
                },
                user: { email: "previous@example.com", id: "previous-owner" },
              }),
              {
                headers: {
                  "content-type": "application/json",
                  "set-auth-token": "rotated-previous-token",
                },
                status: 200,
              }
            )
          )
        )
      );
      const authDirectory = join(home, ".openmeld", "auth");
      const transitionPath = join(authDirectory, "session-transition.json");
      const tokenPath = (tokenRef: { key: string }) =>
        join(authDirectory, "tokens", `${tokenRef.key}.token`);
      const readTokenRef = async (path: string, field?: "previousPayload") => {
        const value = JSON.parse(await readFile(path, "utf8")) as {
          previousPayload?: { tokenRef: { key: string } };
          tokenRef?: { key: string };
        };
        const tokenRef =
          field === "previousPayload"
            ? value.previousPayload?.tokenRef
            : value.tokenRef;
        if (!tokenRef) {
          throw new Error(`Missing tokenRef in ${path}`);
        }
        return tokenRef;
      };
      const journalWrite = { fail: false };
      vi.resetModules();
      vi.doMock("node:fs/promises", async (importOriginal) => {
        const fs = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...fs,
          rename: (from: string, to: string) =>
            journalWrite.fail && to === transitionPath
              ? Promise.reject(
                  Object.assign(new Error("injected journal write failure"), {
                    code: "EIO",
                  })
                )
              : fs.rename(from, to),
        };
      });
      try {
        const restartedAuthSession = await import("../src/config/auth-session");
        const recovery =
          await restartedAuthSession.getInterruptedComputerAuthSessionRecovery();
        const replacedTokenRef = await readTokenRef(
          transitionPath,
          "previousPayload"
        );

        journalWrite.fail = true;
        await expect(
          restartedAuthSession.getAuthSessionState({
            refreshExpired: true,
            validateRemote: true,
          })
        ).rejects.toThrow("injected journal write failure");
        journalWrite.fail = false;

        const committedTokenRef = await readTokenRef(
          join(authDirectory, "session.json")
        );
        expect(committedTokenRef).not.toEqual(replacedTokenRef);
        await expect(
          readTokenRef(transitionPath, "previousPayload")
        ).resolves.toEqual(replacedTokenRef);
        await expect(
          readFile(tokenPath(replacedTokenRef), "utf8")
        ).resolves.toBeTruthy();

        for (const phase of ["service", "remote_session"] as const) {
          await restartedAuthSession.markInterruptedComputerAuthSessionRecovery(
            { id: recovery?.id ?? "", phase }
          );
        }
        await expect(
          restartedAuthSession.completeInterruptedComputerAuthSessionRecovery(
            recovery?.id ?? ""
          )
        ).resolves.toBe(true);

        await expect(
          readFile(tokenPath(replacedTokenRef), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          restartedAuthSession.getAuthSession()
        ).resolves.toMatchObject({
          accessToken: "rotated-previous-token",
          user: { id: "previous-owner" },
        });
      } finally {
        vi.doUnmock("node:fs/promises");
      }
    });
  });

  it("keeps a durable cleanup record when the replaced previous token cannot be deleted after the journal moved", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: "2026-01-01T00:00:00.000Z",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                session: {
                  expiresAt: "2099-01-01T00:00:00.000Z",
                  id: "previous-session",
                  token: "previous-token",
                  userId: "previous-owner",
                },
                user: { email: "previous@example.com", id: "previous-owner" },
              }),
              {
                headers: {
                  "content-type": "application/json",
                  "set-auth-token": "rotated-previous-token",
                },
                status: 200,
              }
            )
          )
        )
      );
      const authDirectory = join(home, ".openmeld", "auth");
      const transitionPath = join(authDirectory, "session-transition.json");
      const tokenPath = (tokenRef: { key: string }) =>
        join(authDirectory, "tokens", `${tokenRef.key}.token`);
      const readTokenRef = async (path: string, field?: "previousPayload") => {
        const value = JSON.parse(await readFile(path, "utf8")) as {
          previousPayload?: { tokenRef: { key: string } };
          tokenRef?: { key: string };
        };
        const tokenRef =
          field === "previousPayload"
            ? value.previousPayload?.tokenRef
            : value.tokenRef;
        if (!tokenRef) {
          throw new Error(`Missing tokenRef in ${path}`);
        }
        return tokenRef;
      };
      const tokenDelete = { failPath: "" };
      vi.resetModules();
      vi.doMock("node:fs/promises", async (importOriginal) => {
        const fs = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...fs,
          rm: (path: string, options?: Parameters<typeof fs.rm>[1]) =>
            tokenDelete.failPath && path === tokenDelete.failPath
              ? Promise.reject(
                  Object.assign(new Error("injected token delete failure"), {
                    code: "EIO",
                  })
                )
              : fs.rm(path, options),
        };
      });
      try {
        const restartedAuthSession = await import("../src/config/auth-session");
        const recovery =
          await restartedAuthSession.getInterruptedComputerAuthSessionRecovery();
        const replacedTokenRef = await readTokenRef(
          transitionPath,
          "previousPayload"
        );

        tokenDelete.failPath = tokenPath(replacedTokenRef);
        await expect(
          restartedAuthSession.getAuthSessionState({
            refreshExpired: true,
            validateRemote: true,
          })
        ).resolves.toMatchObject({ state: "valid" });
        tokenDelete.failPath = "";

        const committedTokenRef = await readTokenRef(
          join(authDirectory, "session.json")
        );
        expect(committedTokenRef).not.toEqual(replacedTokenRef);
        await expect(
          readTokenRef(transitionPath, "previousPayload")
        ).resolves.toEqual(committedTokenRef);
        await expect(
          readFile(tokenPath(replacedTokenRef), "utf8")
        ).resolves.toBeTruthy();
        const pendingCleanup = JSON.parse(
          await readFile(
            join(authDirectory, "pending-token-cleanup.json"),
            "utf8"
          )
        ) as { tokenRefs: unknown[] };
        expect(pendingCleanup.tokenRefs).toContainEqual(replacedTokenRef);

        for (const phase of ["service", "remote_session"] as const) {
          await restartedAuthSession.markInterruptedComputerAuthSessionRecovery(
            { id: recovery?.id ?? "", phase }
          );
        }
        await expect(
          restartedAuthSession.completeInterruptedComputerAuthSessionRecovery(
            recovery?.id ?? ""
          )
        ).resolves.toBe(true);
        await restartedAuthSession.clearAuthSession();
        await expect(
          readFile(tokenPath(replacedTokenRef), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          readFile(join(authDirectory, "pending-token-cleanup.json"), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        vi.doUnmock("node:fs/promises");
      }
    });
  });

  it("finishes recovery cleanup when the committed sign-in metadata is corrupt", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });
      vi.resetModules();
      const restartedAuthSession = await import("../src/config/auth-session");
      const recovery =
        await restartedAuthSession.getInterruptedComputerAuthSessionRecovery();
      for (const phase of ["service", "remote_session"] as const) {
        await restartedAuthSession.markInterruptedComputerAuthSessionRecovery({
          id: recovery?.id ?? "",
          phase,
        });
      }
      const authDirectory = join(home, ".openmeld", "auth");
      await writeFile(join(authDirectory, "session.json"), "{not json", "utf8");

      await expect(
        restartedAuthSession.completeInterruptedComputerAuthSessionRecovery(
          recovery?.id ?? ""
        )
      ).resolves.toBe(true);
      await expect(
        readFile(join(authDirectory, "session-transition.json"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        restartedAuthSession.clearAuthSession()
      ).resolves.toMatchObject({
        hadLocalSession: true,
        preservedSessionPath: expect.stringContaining("session-corrupt-"),
      });
    });
  });

  it("points Service admission to sign-in once the interrupted handoff only needs recovery", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });
      vi.resetModules();
      const restartedAuthSession = await import("../src/config/auth-session");
      await restartedAuthSession.getInterruptedComputerAuthSessionRecovery();

      const failure = await restartedAuthSession
        .readServiceAdmissionSessionWithOwnership()
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        name: "AuthSessionRecoveryInProgressError",
        message: expect.stringContaining("openmeld login"),
      });
      expect(String((failure as Error).message)).not.toContain(
        "Wait for that setup"
      );
    });
  });

  it("finishes recovery after the candidate token was deleted but journal unlink failed", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });

      vi.resetModules();
      const interruptedProcess = await import("../src/config/auth-session");
      const recovery =
        await interruptedProcess.getInterruptedComputerAuthSessionRecovery();
      expect(recovery).not.toBeNull();
      await interruptedProcess.markInterruptedComputerAuthSessionRecovery({
        id: recovery?.id ?? "",
        phase: "service",
      });
      await interruptedProcess.markInterruptedComputerAuthSessionRecovery({
        id: recovery?.id ?? "",
        phase: "remote_session",
      });

      const authDirectory = join(home, ".openmeld", "auth");
      await chmod(authDirectory, 0o500);
      try {
        await expect(
          interruptedProcess.completeInterruptedComputerAuthSessionRecovery(
            recovery?.id ?? ""
          )
        ).resolves.toBe(false);
      } finally {
        await chmod(authDirectory, 0o700);
      }

      vi.resetModules();
      const restartedProcess = await import("../src/config/auth-session");
      await expect(
        restartedProcess.getInterruptedComputerAuthSessionRecovery()
      ).resolves.toBeNull();
      await expect(
        restartedProcess.getAuthSessionState()
      ).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "previous-token",
          user: { id: "previous-owner" },
        },
      });
      await expect(
        readFile(join(authDirectory, "session-transition.json"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("keeps login and logout from invalidating a deferred Computer recovery", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        computerHandoff: true,
        user: { id: "candidate-owner" },
      });

      vi.resetModules();
      const interruptedProcess = await import("../src/config/auth-session");
      const recovery =
        await interruptedProcess.getInterruptedComputerAuthSessionRecovery();
      expect(recovery).not.toBeNull();
      await interruptedProcess.markInterruptedComputerAuthSessionRecovery({
        id: recovery?.id ?? "",
        phase: "service",
      });
      await interruptedProcess.recordInterruptedComputerAuthSessionRecoveryFailure(
        {
          endpoint: "https://auth.openmeld.invalid/api/auth/sign-out",
          id: recovery?.id ?? "",
          message: "Auth Worker unavailable",
          phase: "remote_session",
          status: 503,
        }
      );

      await expect(
        interruptedProcess.setAuthSession({
          accessToken: "unrelated-login-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "unrelated-owner" },
        })
      ).rejects.toMatchObject({
        name: "AuthSessionRecoveryInProgressError",
      });
      await expect(interruptedProcess.clearAuthSession()).rejects.toMatchObject(
        {
          name: "AuthSessionRecoveryInProgressError",
        }
      );

      vi.resetModules();
      const restartedProcess = await import("../src/config/auth-session");
      await expect(
        restartedProcess.getInterruptedComputerAuthSessionRecovery()
      ).resolves.toMatchObject({
        candidateSession: {
          accessToken: "candidate-token",
          user: { id: "candidate-owner" },
        },
        previousOwnerUserId: "previous-owner",
        remoteSessionRevoked: false,
        serviceReconciled: true,
      });
      await expect(
        restartedProcess.getAuthSessionState()
      ).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "previous-token",
          user: { id: "previous-owner" },
        },
      });
    });
  });

  it("clears an incomplete first sign-in after a setup process crashes", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await beginThenCrashAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "candidate-owner" },
      });

      vi.resetModules();
      const { getAuthSessionState: getRestartedAuthSessionState } =
        await import("../src/config/auth-session");

      await expect(getRestartedAuthSessionState()).resolves.toMatchObject({
        reasonCode: "session_missing",
        state: "missing",
        session: null,
      });
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("keeps a durably committed candidate when the process stops before journal cleanup", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      await beginAuthSessionTransition({
        accessToken: "committed-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "committed-owner" },
      });
      const transitionPath = join(
        home,
        ".openmeld",
        "auth",
        "session-transition.json"
      );
      const committedJournal = JSON.parse(
        await readFile(transitionPath, "utf8")
      ) as Record<string, unknown> & {
        candidatePayload: Record<string, unknown>;
      };
      await writeFile(
        join(home, ".openmeld", "auth", "session.json"),
        `${JSON.stringify(committedJournal.candidatePayload)}\n`,
        "utf8"
      );
      await writeFile(
        transitionPath,
        `${JSON.stringify({ ...committedJournal, state: "committed" })}\n`,
        "utf8"
      );

      vi.resetModules();
      const { getAuthSessionState: getRestartedAuthSessionState } =
        await import("../src/config/auth-session");

      await expect(getRestartedAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "committed-token",
          user: { id: "committed-owner" },
        },
      });
      await expect(readFile(transitionPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("refuses to replace an unresolved auth session transition", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const firstTransition = await beginAuthSessionTransition({
        accessToken: "first-candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "first-candidate-owner" },
      });
      const transitionPath = join(
        home,
        ".openmeld",
        "auth",
        "session-transition.json"
      );
      const firstJournal = await readFile(transitionPath, "utf8");

      await expect(
        beginAuthSessionTransition({
          accessToken: "second-candidate-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "second-candidate-owner" },
        })
      ).rejects.toMatchObject({
        name: "AuthSessionRecoveryInProgressError",
      });

      await expect(readFile(transitionPath, "utf8")).resolves.toBe(
        firstJournal
      );
      await expect(getAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "first-candidate-token",
          user: { id: "first-candidate-owner" },
        },
      });

      await firstTransition.rollback();
      await expect(getAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "previous-token",
          user: { id: "previous-owner" },
        },
      });
    });
  });

  it("treats durable commit as successful when post-commit cleanup must be retried", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "previous-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      const previousPayload = JSON.parse(
        await readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ) as { tokenRef: { key: string } };
      const transition = await beginAuthSessionTransition({
        accessToken: "committed-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "committed-owner" },
      });
      const pendingCleanupPath = join(
        home,
        ".openmeld",
        "auth",
        "pending-token-cleanup.json"
      );
      const previousTokenPath = join(
        home,
        ".openmeld",
        "auth",
        "tokens",
        `${previousPayload.tokenRef.key}.token`
      );
      await rm(previousTokenPath, { force: true });
      await mkdir(previousTokenPath);
      await writeFile(pendingCleanupPath, "{not-json\n", "utf8");

      await expect(transition.commit()).resolves.toBeUndefined();

      const transitionPath = join(
        home,
        ".openmeld",
        "auth",
        "session-transition.json"
      );
      await expect(readFile(transitionPath, "utf8")).resolves.toContain(
        '"state": "committed"'
      );

      await rm(pendingCleanupPath, { force: true });
      await rm(previousTokenPath, { recursive: true });
      vi.resetModules();
      const { getAuthSessionState: getRestartedAuthSessionState } =
        await import("../src/config/auth-session");
      await expect(getRestartedAuthSessionState()).resolves.toMatchObject({
        state: "valid",
        session: {
          accessToken: "committed-token",
          user: { id: "committed-owner" },
        },
      });
    });
  });

  it("keeps an old Keychain location pending when npm replaces an unreadable session", async () => {
    await withTempHome(async (home) => {
      const authDirectory = join(home, ".openmeld", "auth");
      await mkdir(authDirectory, { recursive: true });
      await writeFile(
        join(authDirectory, "session.json"),
        `${JSON.stringify({
          v: 1,
          tokenRef: {
            provider: "macos-keychain",
            service: "sh.openmeld.auth.token",
            account: "openmeld-auth-old-npm-session",
          },
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: new Date().toISOString(),
        })}\n`,
        "utf8"
      );
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await setAuthSession({
        accessToken: "replacement-npm-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const session = JSON.parse(
        await readFile(join(authDirectory, "session.json"), "utf8")
      ) as { tokenRef: { provider: string } };
      expect(session.tokenRef.provider).toBe("insecure-file");
      await expect(
        readFile(join(authDirectory, "pending-token-cleanup.json"), "utf8")
      ).resolves.toContain("openmeld-auth-old-npm-session");
      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "replacement-npm-token",
      });
    });
  });

  it("updates active organization without rewriting the stored access token", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-123",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      await updateAuthSessionActiveOrganization({
        id: "org_456",
        slug: "launch",
        name: "Launch Team",
      });

      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "token-123",
        activeOrganization: {
          id: "org_456",
          slug: "launch",
          name: "Launch Team",
        },
      });
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.not.toContain("token-123");

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("clears auth session", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-123",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await clearAuthSession();
      await expect(getAuthSession()).resolves.toBeNull();
      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reports missing auth state when session is absent", async () => {
    await withTempHome(async () => {
      const state = await getAuthSessionState();
      expect(state.state).toBe("missing");
      expect(state.reasonCode).toBe("session_missing");
      expect(state.session).toBeNull();
    });
  });

  it("reports expired auth state", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-expired",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        scope: "openid profile email",
      });

      const state = await getAuthSessionState();
      expect(state.state).toBe("expired");
      expect(state.reasonCode).toBe("session_expired");
      expect(state.session?.accessToken).toBe("token-expired");

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reports malformed session expiry as invalid credentials", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-invalid-expiry",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: "not-a-date",
      });

      await expect(getAuthSessionState()).resolves.toMatchObject({
        reasonCode: "session_expiry_invalid",
        state: "invalid",
        session: null,
      });
    });
  });

  it("reports invalid auth state for malformed session payload", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await mkdir(join(home, ".openmeld", "auth"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "auth", "session.json"),
        `${JSON.stringify(
          {
            v: 1,
            tokenRef: { provider: "insecure-file" },
            tokenType: "Bearer",
            authBaseUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            createdAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const state = await getAuthSessionState();
      expect(state.state).toBe("invalid");
      expect(state.reasonCode).toBe("session_token_ref_invalid");
      expect(state.session).toBeNull();
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.toContain('"provider": "insecure-file"');

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reports corrupt session JSON as invalid instead of signed out", async () => {
    await withTempHome(async (home) => {
      const authDirectory = join(home, ".openmeld", "auth");
      await mkdir(authDirectory, { recursive: true });
      await writeFile(
        join(authDirectory, "session.json"),
        "{not-json\n",
        "utf8"
      );

      await expect(getAuthSessionState()).resolves.toMatchObject({
        errorMessage: expect.stringContaining("session.json"),
        reasonCode: "session_metadata_invalid",
        state: "invalid",
        session: null,
      });
      await expect(
        beginAuthSessionTransition({
          accessToken: "replacement-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "replacement-owner" },
        })
      ).rejects.toThrow("current auth session metadata is corrupt");
      await expect(
        readFile(join(authDirectory, "session.json"), "utf8")
      ).resolves.toBe("{not-json\n");
      const cleared = await clearAuthSession();
      expect(cleared.hadLocalSession).toBe(true);
      expect(cleared.preservedSessionPath).toBeTruthy();
      if (!cleared.preservedSessionPath) {
        throw new Error("expected preserved damaged record");
      }
      await expect(
        readFile(cleared.preservedSessionPath, "utf8")
      ).resolves.toBe("{not-json\n");
      await expect(
        getAuthSessionState({ validateRemote: false })
      ).resolves.toMatchObject({ state: "missing" });
      await setAuthSession({
        accessToken: "replacement-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "replacement-owner" },
      });
      await expect(getAuthSession()).resolves.toMatchObject({
        user: { id: "replacement-owner" },
      });
    });
  });

  it("reports unreadable session storage as invalid instead of signed out", async () => {
    await withTempHome(async (home) => {
      const sessionPath = join(home, ".openmeld", "auth", "session.json");
      await mkdir(sessionPath, { recursive: true });

      await expect(getAuthSessionState()).resolves.toMatchObject({
        errorMessage: expect.stringContaining("session.json"),
        reasonCode: "session_metadata_invalid",
        state: "invalid",
        session: null,
      });
      await expect(
        beginAuthSessionTransition({
          accessToken: "replacement-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "replacement-owner" },
        })
      ).rejects.toThrow("current auth session metadata could not be read");
      await expect(readFile(sessionPath, "utf8")).rejects.toMatchObject({
        code: expect.any(String),
      });
    });
  });

  it("reports invalid auth state for a tampered insecure-file token key", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld", "auth"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "auth", "session.json"),
        `${JSON.stringify(
          {
            v: 1,
            tokenRef: {
              provider: "insecure-file",
              key: "../escape",
            },
            tokenType: "Bearer",
            authBaseUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            createdAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const state = await getAuthSessionState();
      expect(state.state).toBe("invalid");
      expect(state.reasonCode).toBe("session_token_ref_invalid");
      expect(state.session).toBeNull();
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.toContain("../escape");
    });
  });

  it("reports invalid auth state after restart without deleting a session whose token is missing", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-missing",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      const sessionPath = join(home, ".openmeld", "auth", "session.json");
      const rawSession = await readFile(sessionPath, "utf8");
      const payload = JSON.parse(rawSession) as {
        tokenRef: { key: string; provider: "insecure-file" };
      };
      await rm(
        join(
          home,
          ".openmeld",
          "auth",
          "tokens",
          `${payload.tokenRef.key}.token`
        )
      );

      vi.resetModules();
      const { getAuthSessionState: getReloadedAuthSessionState } = await import(
        "../src/config/auth-session"
      );
      const state = await getReloadedAuthSessionState();
      expect(state.state).toBe("invalid");
      expect(state.reasonCode).toBe("session_token_missing");
      expect(state.session).toBeNull();
      await expect(readFile(sessionPath, "utf8")).resolves.toBe(rawSession);

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("marks auth state revoked when /api/auth/get-session returns 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 401,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-revoked",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        scope: "openid profile email",
      });

      const state = await getAuthSessionState({
        validateRemote: true,
      });
      expect(state.state).toBe("revoked");
      expect(state.reasonCode).toBe("remote_session_revoked");
      expect(state.session).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.toContain("tokenRef");

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("keeps local session when remote validation returns transient 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-transient",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const state = await getAuthSessionState({
        validateRemote: true,
      });
      expect(state.state).toBe("valid");
      expect(state.session?.accessToken).toBe("token-transient");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "token-transient",
      });

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("keeps remote validation valid when Better Auth returns only activeOrganizationId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session: {
            id: "session-1",
            activeOrganizationId: "org_remote",
          },
          user: {
            id: "user-1",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-valid",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const state = await getAuthSessionState({
        validateRemote: true,
      });
      expect(state.state).toBe("valid");
      expect(state.session?.activeOrganization).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(getAuthSession()).resolves.not.toHaveProperty(
        "activeOrganization"
      );

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("treats invalid auth base URL as invalid on remote validation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-invalid-url",
        tokenType: "Bearer",
        authBaseUrl: "not-a-url",
        clientId: "openmeld-cli",
      });

      const state = await getAuthSessionState({
        validateRemote: true,
      });
      expect(state.state).toBe("invalid");
      expect(state.reasonCode).toBe("remote_session_invalid");
      expect(state.session).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.toContain("not-a-url");

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("pins Better Auth /get-session as id-only with no expanded organization", () => {
    // Real captured GET /api/auth/get-session body (better-auth 1.6.23
    // organization plugin, default config), captured from a real betterAuth
    // instance. The session carries only activeOrganizationId; there is no
    // expanded organization object anywhere, so no slug/name can be read from
    // this payload. This fixture pins that contract so no future parser is
    // written against a shape Better Auth never returns (anti-pattern #9).
    const realGetSessionResponse = {
      session: {
        id: "0c1f16d7-3986-4706-badb-0b92c9c0154e",
        token: "CvJzJf8DWx8jQhMdmCr3WAQAFnN3VfjJ",
        userId: "6707746e-6b5c-43a0-b14f-0fc720fa6713",
        activeOrganizationId: "5ccb175d-2eef-4e6e-a6f9-b25a1e66d359",
        expiresAt: "2026-07-14T03:13:22.505Z",
        createdAt: "2026-07-07T03:13:22.505Z",
        updatedAt: "2026-07-07T03:13:22.505Z",
        ipAddress: "127.0.0.1",
        userAgent: "",
      },
      user: {
        id: "6707746e-6b5c-43a0-b14f-0fc720fa6713",
        name: "Probe User",
        email: "probe@example.com",
        emailVerified: true,
        image: null,
        username: null,
        displayUsername: null,
        createdAt: "2026-07-07T03:13:22.453Z",
        updatedAt: "2026-07-07T03:13:22.453Z",
      },
    };

    expect(
      readActiveOrganizationIdFromSessionPayload(realGetSessionResponse)
    ).toBe("5ccb175d-2eef-4e6e-a6f9-b25a1e66d359");
    expect(realGetSessionResponse.session).not.toHaveProperty(
      "activeOrganization"
    );
    expect(realGetSessionResponse).not.toHaveProperty("activeOrganization");
  });
});

async function beginThenCrashAuthSessionTransition(input: {
  accessToken: string;
  authBaseUrl: string;
  clientId: string;
  computerHandoff?: boolean;
  startCandidateService?: boolean;
  user: { id: string };
}): Promise<number> {
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
  const transitionInput = {
    accessToken: input.accessToken,
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
    user: input.user,
  };
  const transitionContext =
    input.startCandidateService || input.computerHandoff
      ? { computerHandoff: { gatewayUrl: "https://gateway.openmeld.invalid" } }
      : {};
  const candidateServiceScript = `
    import { getAuthSessionState } from ${JSON.stringify(authSessionModuleUrl)};
    const auth = await getAuthSessionState();
    process.stdout.write(
      "AUTH_CANDIDATE_SERVICE " +
        JSON.stringify({ ownerUserId: auth.session?.user?.id ?? null, pid: process.pid }) +
        "\\n"
    );
    process.on("SIGTERM", () => process.exit(0));
    setInterval(() => undefined, 60_000);
  `;
  const script = `
    import { spawn } from "node:child_process";
    import { beginAuthSessionTransition } from ${JSON.stringify(authSessionModuleUrl)};
    await beginAuthSessionTransition(${JSON.stringify(transitionInput)}, ${JSON.stringify(transitionContext)});
    if (${JSON.stringify(input.startCandidateService === true)}) {
      const service = spawn(
        process.execPath,
        ["--import", ${JSON.stringify(tsxLoaderPath)}, "--input-type=module", "--eval", ${JSON.stringify(candidateServiceScript)}],
        {
          env: { ...process.env, OPENMELD_DAEMON_RUNTIME_MODE: "background" },
          stdio: ["ignore", "pipe", "inherit"],
        }
      );
      service.stdout.pipe(process.stdout);
    }
    process.stdout.write("AUTH_TRANSITION_PENDING\\n");
    setInterval(() => undefined, 60_000);
  `;
  const child = spawn(
    process.execPath,
    ["--import", tsxLoaderPath, "--input-type=module", "--eval", script],
    {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let candidateServicePid = 0;
  try {
    const output = await waitForChildOutput(
      child,
      input.startCandidateService
        ? "AUTH_CANDIDATE_SERVICE"
        : "AUTH_TRANSITION_PENDING"
    );
    if (input.startCandidateService) {
      const payload = JSON.parse(output.slice(output.indexOf("{"))) as {
        ownerUserId: string | null;
        pid: number;
      };
      if (payload.ownerUserId !== "candidate-owner") {
        throw new Error(
          `candidate Service loaded unexpected owner ${String(payload.ownerUserId)}`
        );
      }
      candidateServicePid = payload.pid;
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    if (child.exitCode === null && child.signalCode === null) {
      await once(child, "exit");
    }
  }
  return candidateServicePid;
}

async function waitForChildOutput(
  child: ChildProcessWithoutNullStreams,
  expected: string
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for crash fixture output ${expected}. stderr: ${stderr}`
        )
      );
    }, 10_000);
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes(expected)) {
        cleanup();
        const matchingLine = stdout
          .split(LINE_BREAK_RE)
          .find((line) => line.includes(expected));
        resolve(matchingLine ?? stdout);
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Crash fixture exited before creating a pending transition (code=${code}, signal=${signal}). stderr: ${stderr}`
        )
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`candidate service process ${String(pid)} is still running`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcessIfAlive(pid: number): void {
  if (pid > 0 && isProcessAlive(pid)) {
    process.kill(pid, "SIGKILL");
  }
}

async function readOwnerFromRestartedServiceProcess(): Promise<string | null> {
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
  const script = `
    import { getAuthSessionState } from ${JSON.stringify(authSessionModuleUrl)};
    const auth = await getAuthSessionState();
    process.stdout.write(JSON.stringify({ ownerUserId: auth.session?.user?.id ?? null }));
  `;
  const child = spawn(
    process.execPath,
    ["--import", tsxLoaderPath, "--input-type=module", "--eval", script],
    {
      env: { ...process.env, OPENMELD_DAEMON_RUNTIME_MODE: "background" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
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
    throw new Error(`restarted service fixture failed: ${stderr}`);
  }
  return (JSON.parse(stdout) as { ownerUserId: string | null }).ownerUserId;
}

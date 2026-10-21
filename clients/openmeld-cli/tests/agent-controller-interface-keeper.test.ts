import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES } from "../src/agents/builtin-agent-controller-definitions";
import type { AgentTargetState } from "../src/agents/registry";
import { createDefaultRuntimeAgentControllerSettings } from "../src/config/runtime-config";
import { resolveAgentControllerInterfaceSnapshot } from "../src/local-service/inventory/agent-controller-interface";
import {
  AGENT_CONTROLLER_INTERFACE_REPROBE_DELAY_MS,
  ageAgentControllerInterfaceKeeperForTests,
  buildAgentControllerInterfaceKeeperKey,
  consumeArmedAgentControllerInterfaceReprobe,
  readLastKnownAgentControllerUsageLimits,
  readLastSuccessfulAgentControllerInterfaceCheckAt,
  readReusableAgentControllerInterfaceSnapshot,
  recordAgentControllerInterfaceProbeFailure,
  recordAgentControllerInterfaceProbeSuccess,
  recordAgentControllerUsageLimitsObservation,
  resetAgentControllerInterfaceKeeperForTests,
  resolveAgentControllerCommandFingerprint,
  resolveNextRuntimeAgentControllerReportSyncAtMs,
} from "../src/local-service/inventory/agent-controller-interface-keeper";
import { OPENCODE_NPM_LATEST_RESPONSE } from "./fixtures/opencode-npm-latest";
import { OPENCODE_CONNECTED_PROVIDER_LIST_RESPONSE } from "./fixtures/opencode-provider-list";

const { createOpencodeClientMock } = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn(),
}));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: createOpencodeClientMock,
}));

const KEEPER_TTL_MS = 60_000;

beforeEach(() => {
  resetAgentControllerInterfaceKeeperForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Response.json(OPENCODE_NPM_LATEST_RESPONSE))
  );
});

afterEach(() => {
  createOpencodeClientMock.mockReset();
  vi.unstubAllGlobals();
});

async function writeOpenCodeBin(
  binPath: string,
  mode: "serving" | "broken"
): Promise<void> {
  const serveLine =
    mode === "serving"
      ? 'if [ "$1" = "serve" ]; then echo "opencode server listening on http://127.0.0.1:34567"; sleep 60; exit 0; fi'
      : 'if [ "$1" = "serve" ]; then exit 1; fi';
  await writeFile(
    binPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "opencode 1.17.11"; exit 0; fi',
      serveLine,
      "exit 1",
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(binPath, 0o755);
}

function mockConnectedProvider(): void {
  createOpencodeClientMock.mockReturnValue({
    app: {
      agents: vi.fn().mockResolvedValue({ data: [] }),
    },
    provider: {
      list: vi.fn().mockResolvedValue({
        data: OPENCODE_CONNECTED_PROVIDER_LIST_RESPONSE,
      }),
    },
  });
}

function mockNoConnectedProvider(): void {
  createOpencodeClientMock.mockReturnValue({
    app: {
      agents: vi.fn().mockResolvedValue({ data: [] }),
    },
    provider: {
      list: vi.fn().mockResolvedValue({
        data: { all: [], connected: [], default: {} },
      }),
    },
  });
}

function mockTransientProviderReadFailure(): void {
  createOpencodeClientMock.mockReturnValue({
    app: {
      agents: vi.fn().mockResolvedValue({ data: [] }),
    },
    provider: {
      list: vi
        .fn()
        .mockRejectedValue(new Error("temporary provider read failure")),
    },
  });
}

function createOpenCodeAgentTargetState(
  binPath: string
): AgentTargetState & { targetKind: "builtin" } {
  return {
    agentId: "opencode",
    contextIdMappingSpec:
      createDefaultRuntimeAgentControllerSettings("opencode")
        .contextIdMappingSpec,
    detected: true,
    displayName: "OpenCode",
    enabled: true,
    installChoices: [],
    lifecycleStatus: "active",
    launchContract: {
      commandPath: binPath,
      kind: "executable",
    },
    launchStatus: "ready",
    launchStatusDetail: null,
    registered: true,
    registration: null,
    runtimeSupported: true,
    selectable: true,
    selectableReason: null,
    targetKind: "builtin",
    transportModes: [
      {
        description: "Run through the local CLI on this computer.",
        label: "Local CLI",
        mode: "local-cli",
      },
    ],
  };
}

describe("agent controller interface probe keeper", () => {
  it("reuses the last completed snapshot for background probes within the TTL", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-keeper-ttl-"));
    try {
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(binPath, "serving");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const first = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      const second = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });

      expect(first.status).toBe("ready");
      // The second background pass reuses the held snapshot without spawning
      // another probe server.
      expect(second).toBe(first);
      expect(createOpencodeClientMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("invalidates a reusable snapshot when the binary size changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-keeper-size-"));
    try {
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(binPath, "serving");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const first = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      await appendFile(binPath, "# upgraded binary\n", "utf8");
      const second = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });

      expect(second).not.toBe(first);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("invalidates a reusable snapshot when only the binary mtime changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-keeper-mtime-"));
    try {
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(binPath, "serving");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const first = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      const initialStat = await stat(binPath);
      const changedTime = new Date(initialStat.mtimeMs + 2000);
      await utimes(binPath, changedTime, changedTime);
      const second = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });

      expect(second).not.toBe(first);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("invalidates a reusable snapshot when a symlink resolves to another binary", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-keeper-realpath-"));
    try {
      const firstTargetPath = join(home, "opencode-v1");
      const secondTargetPath = join(home, "opencode-v2");
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(firstTargetPath, "serving");
      await writeOpenCodeBin(secondTargetPath, "serving");
      await symlink(firstTargetPath, binPath);
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const first = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      await rm(binPath);
      await symlink(secondTargetPath, binPath);
      const second = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });

      expect(second).not.toBe(first);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("does not cache a snapshot when the binary changes during the probe", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-keeper-race-"));
    try {
      const firstTargetPath = join(home, "opencode-v1");
      const secondTargetPath = join(home, "opencode-v2");
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(firstTargetPath, "serving");
      await writeOpenCodeBin(secondTargetPath, "serving");
      await symlink(firstTargetPath, binPath);
      const providerListResult = {
        data: OPENCODE_CONNECTED_PROVIDER_LIST_RESPONSE,
      };
      const providerListResolver: {
        current: ((value: typeof providerListResult) => void) | null;
      } = { current: null };
      let markProviderListStarted: (() => void) | null = null;
      const providerListStarted = new Promise<void>((resolve) => {
        markProviderListStarted = resolve;
      });
      const providerList = vi.fn(async () => {
        markProviderListStarted?.();
        return await new Promise<typeof providerListResult>((resolve) => {
          providerListResolver.current = resolve;
        });
      });
      createOpencodeClientMock.mockReturnValue({
        app: {
          agents: vi.fn().mockResolvedValue({ data: [] }),
        },
        provider: { list: providerList },
      });
      const state = createOpenCodeAgentTargetState(binPath);

      const firstProbePromise = resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      await providerListStarted;
      expect(providerList).toHaveBeenCalledTimes(1);
      await rm(binPath);
      await symlink(secondTargetPath, binPath);
      const resolveProviderList = providerListResolver.current;
      if (!resolveProviderList) {
        throw new Error("expected the first provider read to be pending");
      }
      resolveProviderList(providerListResult);
      const first = await firstProbePromise;

      mockConnectedProvider();
      const second = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });

      expect(second).not.toBe(first);
      expect(createOpencodeClientMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("does not carry historical success across a binary change during a failed probe", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-keeper-failed-race-")
    );
    try {
      const firstTargetPath = join(home, "opencode-v1");
      const secondTargetPath = join(home, "opencode-v2");
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(firstTargetPath, "serving");
      await writeOpenCodeBin(secondTargetPath, "serving");
      await symlink(firstTargetPath, binPath);
      const state = createOpenCodeAgentTargetState(binPath);

      mockConnectedProvider();
      const lastSuccessful = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(lastSuccessful.check?.status).toBe("succeeded");
      ageAgentControllerInterfaceKeeperForTests(KEEPER_TTL_MS + 1);

      const pendingProviderRead: {
        reject: ((reason?: unknown) => void) | null;
      } = { reject: null };
      let markProviderReadStarted: (() => void) | null = null;
      const providerReadStarted = new Promise<void>((resolve) => {
        markProviderReadStarted = resolve;
      });
      createOpencodeClientMock.mockReturnValue({
        app: {
          agents: vi.fn().mockResolvedValue({ data: [] }),
        },
        provider: {
          list: vi.fn(async () => {
            markProviderReadStarted?.();
            return await new Promise((_, reject) => {
              pendingProviderRead.reject = reject;
            });
          }),
        },
      });

      const failedProbePromise = resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      await providerReadStarted;
      await rm(binPath);
      await symlink(secondTargetPath, binPath);
      const rejectProviderRead = pendingProviderRead.reject;
      if (!rejectProviderRead) {
        throw new Error("expected the provider read to be pending");
      }
      rejectProviderRead(new Error("temporary provider read failure"));

      const failedProbe = await failedProbePromise;
      expect(failedProbe).toMatchObject({
        check: {
          lastSucceededAt: null,
          status: "failed",
        },
        status: "unknown",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("invalidates a reusable snapshot when the binary can no longer be statted", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-keeper-stat-"));
    try {
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(binPath, "serving");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const first = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      await rm(binPath);
      const second = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });

      expect(second).not.toBe(first);
      expect(second).toMatchObject({
        check: {
          lastSucceededAt: null,
          status: "failed",
        },
        status: "unknown",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("probes for real on every fresh pass", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-keeper-fresh-"));
    try {
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(binPath, "serving");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state,
      });
      await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state,
      });

      expect(createOpencodeClientMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports a failed check without discarding the last successful evidence", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-keeper-hold-"));
    try {
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(binPath, "serving");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const good = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(good.status).toBe("ready");

      // Push the held snapshot past the reuse TTL so background passes probe
      // again. Keep the binary identical and fail only the provider read, so
      // these checks prove transient load handling rather than binary drift.
      ageAgentControllerInterfaceKeeperForTests(KEEPER_TTL_MS + 1);
      mockTransientProviderReadFailure();

      const firstFailure = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(firstFailure).toMatchObject({
        check: {
          lastSucceededAt: good.checkedAt,
          status: "failed",
        },
        status: "unknown",
      });
      expect(firstFailure.message).toContain(
        "OpenMeld could not confirm a connected OpenCode provider"
      );
      expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(true);

      mockConnectedProvider();
      const recovered = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(recovered.status).toBe("ready");
      expect(recovered).not.toBe(good);
      expect(createOpencodeClientMock).toHaveBeenCalledTimes(3);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports a fresh probe failure immediately even when a held snapshot exists", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-keeper-freshfail-")
    );
    try {
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(binPath, "serving");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const good = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(good.status).toBe("ready");

      await writeOpenCodeBin(binPath, "broken");
      const freshFailure = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "fresh",
        state,
      });

      // A user-driven check reports that the check itself failed without
      // claiming the controller is broken.
      expect(freshFailure).toMatchObject({
        check: {
          // The test replaces the binary before the fresh check, so evidence
          // from the previous executable must not carry across fingerprints.
          lastSucceededAt: null,
          status: "failed",
        },
        status: "unknown",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports a proven not-signed-in outcome immediately on background passes", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-keeper-failclosed-")
    );
    try {
      const binPath = join(home, "opencode");
      await writeOpenCodeBin(binPath, "serving");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const good = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(good.status).toBe("ready");

      // Past the TTL the next background probe runs for real and reaches a
      // live server that proves no provider is connected. That is a completed
      // check: fail-closed reporting must not be smoothed away, while the
      // account blocker remains unavailable rather than a launch error.
      ageAgentControllerInterfaceKeeperForTests(KEEPER_TTL_MS + 1);
      mockNoConnectedProvider();

      const proven = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(proven.status).toBe("unavailable");
      expect(proven.message).toContain("no connected provider was reported");
      const probeCount = createOpencodeClientMock.mock.calls.length;
      const reused = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(reused).toBe(proven);
      expect(createOpencodeClientMock).toHaveBeenCalledTimes(probeCount);

      // Signing in outside OpenMeld can be discovered immediately by an
      // explicit check; the negative cache must not latch the account shut.
      mockConnectedProvider();
      const signedIn = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "fresh",
        state,
      });
      expect(signedIn.auth.status).toBe("authenticated");
      expect(signedIn.status).toBe("ready");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("arms a one-shot re-probe on a first probe failure and retires it after a completed probe", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-keeper-reprobe-e2e-")
    );
    try {
      const binPath = join(home, "opencode");
      // First probe cold-starts a broken controller: it cannot complete.
      await writeOpenCodeBin(binPath, "broken");
      mockConnectedProvider();
      const state = createOpenCodeAgentTargetState(binPath);

      const firstFailure = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      // Fail closed through explicit check evidence, and bring the next pass
      // forward once without claiming the controller itself is broken.
      expect(firstFailure).toMatchObject({
        check: {
          lastSucceededAt: null,
          status: "failed",
        },
        status: "unknown",
      });
      expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(true);

      // The re-probe now finds a healthy controller and completes: the snapshot
      // updates and no arm remains to schedule further re-probes.
      await rm(binPath);
      await writeOpenCodeBin(binPath, "serving");
      const reprobe = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        probePolicy: "background",
        state,
      });
      expect(reprobe.status).toBe("ready");
      expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(false);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });
});

describe("agent controller interface re-probe orchestration", () => {
  const COMMAND_FINGERPRINT = {
    mtimeMs: 1000,
    packageJsonVersion: null,
    realPath: "/usr/local/bin/opencode",
    size: 100,
  } as const;
  const keeperKey = buildAgentControllerInterfaceKeeperKey({
    agentId: "opencode",
    commandPath: "/usr/local/bin/opencode",
  });
  const AUTH_SNAPSHOT = {
    email: "owner@example.com",
    label: "Signed in",
    status: "authenticated" as const,
  };

  function completedSnapshot(): AgentControllerInterfaceSnapshot {
    return {
      agentControllerRef: "builtin:opencode",
      auth: AUTH_SNAPSHOT,
      capabilities: EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES,
      checkedAt: "2026-07-03T10:00:00.000Z",
      controllerId: "opencode",
      displayName: "OpenCode",
      launch: {
        argsPrefix: [],
        commandPath: "/usr/local/bin/opencode",
        installChoiceCount: 0,
        status: "ready",
      },
      message: null,
      models: [],
      nativeInterface: "local-cli",
      schemaVersion: 1,
      skills: [],
      status: "ready",
      version: null,
    };
  }

  it("brings the next sync forward at most once for a first-probe failure", () => {
    // First probe fails with no last-good fallback → arm one re-probe.
    recordAgentControllerInterfaceProbeFailure({ keeperKey });
    // The scheduler observes and consumes the arm exactly once.
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(true);
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(false);
  });

  it("does not re-arm after the single re-probe also fails", () => {
    recordAgentControllerInterfaceProbeFailure({ keeperKey });
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(true);

    // The re-probe also fails to complete: still no last-good, but the one shot
    // is spent (attempted) — it must not re-arm and re-accelerate the cadence.
    recordAgentControllerInterfaceProbeFailure({ keeperKey });
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(false);
  });

  it("retires the arm at observation even if the controller is never re-probed", () => {
    // Regression: a controller can leave the ready state after arming, so it is
    // never probed again and no later probe would clear the arm. Consuming at
    // observation must still self-limit so the sync cadence is not pinned to the
    // re-probe delay forever.
    recordAgentControllerInterfaceProbeFailure({ keeperKey });
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(true);
    // No further probe happens for this controller — the arm stays retired.
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(false);
  });

  it("clears the arm once a probe finally completes", () => {
    recordAgentControllerInterfaceProbeFailure({ keeperKey });
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000,
      snapshot: completedSnapshot(),
    });
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(false);
  });

  it("reuses a completed signed-out check until the normal TTL expires", () => {
    const completedAt = "2026-07-03T10:00:00.000Z";
    recordAgentControllerUsageLimitsObservation({
      authSnapshot: AUTH_SNAPSHOT,
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      usageLimits: [
        {
          key: "claude-code:five-hour",
          label: "5-hour usage limit",
          observedAt: completedAt,
          resetsAt: null,
          status: "available",
          usedPercent: 40,
        },
      ],
    });
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000,
      snapshot: {
        ...completedSnapshot(),
        auth: { status: "unauthenticated" },
        checkedAt: completedAt,
        status: "unavailable",
      },
    });

    expect(
      readReusableAgentControllerInterfaceSnapshot({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
        nowMs: 1001,
      })
    ).toMatchObject({
      auth: { status: "unauthenticated" },
      checkedAt: completedAt,
    });
    expect(
      readReusableAgentControllerInterfaceSnapshot({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
        nowMs: 1000 + KEEPER_TTL_MS,
      })
    ).toBeNull();
    expect(
      readLastSuccessfulAgentControllerInterfaceCheckAt({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
      })
    ).toBe(completedAt);
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(false);
    // A later sign-in must not resurrect capacity observed before sign-out.
    const signedInAgain = recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000 + KEEPER_TTL_MS,
      snapshot: completedSnapshot(),
    });
    expect(signedInAgain.usageLimits).toBeUndefined();
  });

  it("merges passive provider usage evidence into the existing ACI snapshot", () => {
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000,
      snapshot: {
        ...completedSnapshot(),
        usageLimits: [
          {
            key: "provider",
            label: "Usage limits",
            observedAt: "2026-07-03T10:00:00.000Z",
            resetsAt: null,
            status: "unavailable",
            usedPercent: null,
          },
        ],
      },
    });
    recordAgentControllerUsageLimitsObservation({
      authSnapshot: AUTH_SNAPSHOT,
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      usageLimits: [
        {
          key: "claude-code:five-hour",
          label: "5-hour usage limit",
          observedAt: "2026-07-03T10:01:00.000Z",
          resetsAt: "2026-07-03T15:00:00.000Z",
          status: "available",
          usedPercent: 82,
        },
      ],
    });

    expect(
      readLastKnownAgentControllerUsageLimits({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
      })
    ).toEqual([
      {
        key: "claude-code:five-hour",
        label: "5-hour usage limit",
        observedAt: "2026-07-03T10:01:00.000Z",
        resetsAt: "2026-07-03T15:00:00.000Z",
        status: "available",
        usedPercent: 82,
      },
    ]);
  });

  it("does not mix a passive observation into another account", () => {
    const accountALimit = {
      key: "claude-code:five-hour",
      label: "5-hour usage limit",
      observedAt: "2026-07-03T10:00:00.000Z",
      resetsAt: null,
      status: "available" as const,
      usedPercent: 30,
    };
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000,
      snapshot: {
        ...completedSnapshot(),
        auth: {
          email: "account-a@example.com",
          label: "Signed in",
          status: "authenticated",
        },
        usageLimits: [accountALimit],
        usageAdmission: {
          blocksNewWork: false,
          observedAt: accountALimit.observedAt,
        },
      },
    });

    const accountBAuth = {
      email: "account-b@example.com",
      label: "Signed in",
      status: "authenticated" as const,
    };
    const accountBLimit = {
      key: "claude-code:seven-day",
      label: "Weekly usage limit",
      observedAt: "2026-07-03T10:01:00.000Z",
      resetsAt: null,
      status: "available" as const,
      usedPercent: 80,
    };
    recordAgentControllerUsageLimitsObservation({
      authSnapshot: accountBAuth,
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      usageAdmission: {
        blocksNewWork: true,
        observedAt: accountBLimit.observedAt,
      },
      usageLimits: [accountBLimit],
    });

    expect(
      readLastKnownAgentControllerUsageLimits({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
      })
    ).toEqual([accountALimit]);
    expect(
      readReusableAgentControllerInterfaceSnapshot({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
        nowMs: 1001,
      })?.usageAdmission?.blocksNewWork
    ).toBe(false);

    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 2000,
      snapshot: {
        ...completedSnapshot(),
        auth: accountBAuth,
      },
    });
    expect(
      readLastKnownAgentControllerUsageLimits({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
      })
    ).toEqual([accountBLimit]);
    expect(
      readReusableAgentControllerInterfaceSnapshot({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
        nowMs: 2001,
      })?.usageAdmission?.blocksNewWork
    ).toBe(true);
  });

  it("rejects passive usage evidence without stable account identity", () => {
    expect(
      recordAgentControllerUsageLimitsObservation({
        authSnapshot: { status: "unknown" },
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
        usageLimits: [
          {
            key: "claude-code:five-hour",
            label: "5-hour usage limit",
            observedAt: "2026-07-03T10:01:00.000Z",
            resetsAt: null,
            status: "available",
            usedPercent: 40,
          },
        ],
      })
    ).toBe(false);
    expect(
      readLastKnownAgentControllerUsageLimits({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
      })
    ).toBeNull();
  });

  it.each([
    undefined,
    "not_applicable",
    "not_authenticated",
  ] as const)("retains a pre-probe observation only while the account capability remains applicable (%s)", (reason) => {
    const usageLimits = [
      {
        key: "claude-code:seven-day",
        label: "Weekly usage limit",
        observedAt: "2026-07-03T10:01:00.000Z",
        resetsAt: null,
        status: "available" as const,
        usedPercent: 45,
      },
    ];
    recordAgentControllerUsageLimitsObservation({
      authSnapshot: AUTH_SNAPSHOT,
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      usageLimits,
    });
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000,
      snapshot: {
        ...completedSnapshot(),
        ...(reason
          ? {
              usageLimits: [
                {
                  key: "provider",
                  label: "Usage limits",
                  observedAt: "2026-07-03T10:02:00.000Z",
                  resetsAt: null,
                  usedPercent: null,
                  status: "unavailable" as const,
                  reason,
                },
              ],
            }
          : {}),
      },
    });

    expect(
      readLastKnownAgentControllerUsageLimits({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
      })
    ).toEqual(
      reason
        ? [expect.objectContaining({ reason, usedPercent: null })]
        : usageLimits
    );
  });

  it("does not let an older concurrent passive observation replace newer evidence", () => {
    const newerLimit = {
      key: "claude-code:five-hour",
      label: "5-hour usage limit",
      observedAt: "2026-07-03T10:02:00.000Z",
      resetsAt: null,
      status: "available" as const,
      usedPercent: 88,
    };
    recordAgentControllerUsageLimitsObservation({
      authSnapshot: AUTH_SNAPSHOT,
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      usageAdmission: {
        blocksNewWork: false,
        observedAt: newerLimit.observedAt,
      },
      usageLimits: [newerLimit],
    });
    recordAgentControllerUsageLimitsObservation({
      authSnapshot: AUTH_SNAPSHOT,
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      usageAdmission: {
        blocksNewWork: true,
        observedAt: "2026-07-03T10:01:00.000Z",
      },
      usageLimits: [
        {
          ...newerLimit,
          observedAt: "2026-07-03T10:01:00.000Z",
          usedPercent: 70,
        },
      ],
    });

    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000,
      snapshot: completedSnapshot(),
    });
    expect(
      readLastKnownAgentControllerUsageLimits({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
      })
    ).toEqual([newerLimit]);
    const snapshotInput = {
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1001,
    };
    expect(
      readReusableAgentControllerInterfaceSnapshot(snapshotInput)
        ?.usageAdmission
    ).toEqual({ blocksNewWork: false, observedAt: newerLimit.observedAt });
    recordAgentControllerUsageLimitsObservation({
      authSnapshot: AUTH_SNAPSHOT,
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      usageLimits: [{ ...newerLimit, observedAt: "2026-07-03T10:03:00.000Z" }],
    });
    // A sparse native update cannot refresh the earlier account capacity.
    expect(
      readReusableAgentControllerInterfaceSnapshot(snapshotInput)
        ?.usageAdmission?.observedAt
    ).toBe(newerLimit.observedAt);
    const unknownAdmission = {
      blocksNewWork: null,
      observedAt: "2026-07-03T10:04:00.000Z",
    };
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 2000,
      snapshot: { ...completedSnapshot(), usageAdmission: unknownAdmission },
    });
    expect(
      readReusableAgentControllerInterfaceSnapshot({
        ...snapshotInput,
        nowMs: 2001,
      })?.usageAdmission
    ).toEqual(unknownAdmission);
  });

  it("keeps authenticated historical evidence without reusing it after a failed probe", () => {
    const lastSuccessfulSnapshot = completedSnapshot();
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000,
      snapshot: lastSuccessfulSnapshot,
    });
    recordAgentControllerInterfaceProbeFailure({ keeperKey });

    expect(
      readReusableAgentControllerInterfaceSnapshot({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
        nowMs: 1001,
      })
    ).toBeNull();
    expect(
      readLastSuccessfulAgentControllerInterfaceCheckAt({
        commandFingerprint: COMMAND_FINGERPRINT,
        keeperKey,
      })
    ).toBe(lastSuccessfulSnapshot.checkedAt);
  });

  it("arms one re-probe when a failed check follows a successful snapshot", () => {
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: COMMAND_FINGERPRINT,
      keeperKey,
      nowMs: 1000,
      snapshot: completedSnapshot(),
    });
    recordAgentControllerInterfaceProbeFailure({ keeperKey });
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(true);
    expect(consumeArmedAgentControllerInterfaceReprobe()).toBe(false);
  });

  it("keeps the base cadence when no re-probe is armed", () => {
    expect(
      resolveNextRuntimeAgentControllerReportSyncAtMs({
        nowMs: 10_000,
        passStartedAtMs: 10_000,
        baseRetryMs: 5 * 60_000,
        hasArmedReprobe: false,
      })
    ).toBe(10_000 + 5 * 60_000);
  });

  it("brings the next sync forward to the re-probe delay when armed", () => {
    // Base cadence (5 min) is later than the re-probe delay → forward to delay.
    expect(
      resolveNextRuntimeAgentControllerReportSyncAtMs({
        nowMs: 10_000,
        passStartedAtMs: 10_000,
        baseRetryMs: 5 * 60_000,
        hasArmedReprobe: true,
      })
    ).toBe(10_000 + AGENT_CONTROLLER_INTERFACE_REPROBE_DELAY_MS);
  });

  it("never delays an already-sooner base cadence past the re-probe delay", () => {
    // Base cadence is sooner than the re-probe delay → keep the base (min).
    const baseRetryMs = 1000;
    expect(
      resolveNextRuntimeAgentControllerReportSyncAtMs({
        nowMs: 10_000,
        passStartedAtMs: 10_000,
        baseRetryMs,
        hasArmedReprobe: true,
      })
    ).toBe(10_000 + baseRetryMs);
  });
});

describe("runtime agent controller report cadence", () => {
  it("measures the next pass from when the slow pass started checking", () => {
    // A 70s pass that started at t=0 must not push the next check of each
    // controller to t=130s: Core treats a native check older than two minutes
    // as stale, which used to show a healthy controller as unable to start.
    expect(
      resolveNextRuntimeAgentControllerReportSyncAtMs({
        nowMs: 70_000,
        passStartedAtMs: 0,
        baseRetryMs: 60_000,
        hasArmedReprobe: false,
      })
    ).toBe(70_000);
    expect(
      resolveNextRuntimeAgentControllerReportSyncAtMs({
        nowMs: 20_000,
        passStartedAtMs: 0,
        baseRetryMs: 60_000,
        hasArmedReprobe: false,
      })
    ).toBe(60_000);
  });
});

describe("agent controller command fingerprint", () => {
  it("includes the owning npm package's version for a node_script launch contract", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-fingerprint-pkg-"));
    try {
      // Mirrors the real npm global layout: bin/codex.js is a symlink target
      // one directory below the package root that holds package.json.
      const packageDir = join(home, "lib", "node_modules", "@openai", "codex");
      const binDir = join(packageDir, "bin");
      await mkdir(binDir, { recursive: true });
      const scriptPath = join(binDir, "codex.js");
      await writeFile(
        scriptPath,
        "#!/usr/bin/env node\nconsole.log('codex');\n",
        "utf8"
      );
      await chmod(scriptPath, 0o755);
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "@openai/codex", version: "0.144.1" }),
        "utf8"
      );

      const fingerprint = await resolveAgentControllerCommandFingerprint({
        commandPath: scriptPath,
        launchContractKind: "node_script",
      });

      expect(fingerprint?.packageJsonVersion).toBe("0.144.1");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("walks up past intermediate directories to find the package root", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-fingerprint-nested-")
    );
    try {
      const packageDir = join(home, "node_modules", "some-agent-cli");
      const scriptDir = join(packageDir, "dist", "bin");
      await mkdir(scriptDir, { recursive: true });
      const scriptPath = join(scriptDir, "cli.js");
      await writeFile(scriptPath, "#!/usr/bin/env node\n", "utf8");
      await chmod(scriptPath, 0o755);
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "some-agent-cli", version: "2.3.4" }),
        "utf8"
      );

      const fingerprint = await resolveAgentControllerCommandFingerprint({
        commandPath: scriptPath,
        launchContractKind: "node_script",
      });

      expect(fingerprint?.packageJsonVersion).toBe("2.3.4");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("degrades to a null package version when no package.json exists", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-fingerprint-nopkg-")
    );
    try {
      const scriptPath = join(home, "standalone-script.js");
      await writeFile(
        scriptPath,
        "#!/usr/bin/env node\nconsole.log('standalone');\n",
        "utf8"
      );
      await chmod(scriptPath, 0o755);

      const fingerprint = await resolveAgentControllerCommandFingerprint({
        commandPath: scriptPath,
        launchContractKind: "node_script",
      });

      // Graceful degradation: the fingerprint itself must still resolve (from
      // mtime/size/realpath) even though no package.json was found.
      expect(fingerprint).not.toBeNull();
      expect(fingerprint?.packageJsonVersion).toBeNull();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("degrades to a null package version when package.json is malformed", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-fingerprint-badpkg-")
    );
    try {
      const packageDir = join(home, "pkg");
      const binDir = join(packageDir, "bin");
      await mkdir(binDir, { recursive: true });
      const scriptPath = join(binDir, "cli.js");
      await writeFile(scriptPath, "#!/usr/bin/env node\n", "utf8");
      await chmod(scriptPath, 0o755);
      await writeFile(
        join(packageDir, "package.json"),
        "{ this is not valid json",
        "utf8"
      );

      const fingerprint = await resolveAgentControllerCommandFingerprint({
        commandPath: scriptPath,
        launchContractKind: "node_script",
      });

      expect(fingerprint).not.toBeNull();
      expect(fingerprint?.packageJsonVersion).toBeNull();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("degrades to a null package version when package.json has no version field", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-fingerprint-noversion-")
    );
    try {
      const packageDir = join(home, "pkg");
      const binDir = join(packageDir, "bin");
      await mkdir(binDir, { recursive: true });
      const scriptPath = join(binDir, "cli.js");
      await writeFile(scriptPath, "#!/usr/bin/env node\n", "utf8");
      await chmod(scriptPath, 0o755);
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "no-version-pkg" }),
        "utf8"
      );

      const fingerprint = await resolveAgentControllerCommandFingerprint({
        commandPath: scriptPath,
        launchContractKind: "node_script",
      });

      expect(fingerprint?.packageJsonVersion).toBeNull();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("does not look up a package version for an executable launch contract", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-fingerprint-exec-")
    );
    try {
      // Even though a real package.json with a version sits right next to the
      // binary, an "executable" kind contract must ignore it: only node_script
      // contracts run through a vendored npm package payload.
      const packageDir = join(home, "pkg");
      const binDir = join(packageDir, "bin");
      await mkdir(binDir, { recursive: true });
      const scriptPath = join(binDir, "opencode");
      await writeFile(scriptPath, "#!/bin/sh\necho ok\n", "utf8");
      await chmod(scriptPath, 0o755);
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({ version: "9.9.9" }),
        "utf8"
      );

      const fingerprint = await resolveAgentControllerCommandFingerprint({
        commandPath: scriptPath,
        launchContractKind: "executable",
      });

      expect(fingerprint?.packageJsonVersion).toBeNull();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("differentiates fingerprints by package version alone when mtime and size are held constant", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-fingerprint-diff-")
    );
    try {
      const packageDir = join(home, "pkg");
      const binDir = join(packageDir, "bin");
      await mkdir(binDir, { recursive: true });
      const scriptPath = join(binDir, "codex.js");
      await writeFile(scriptPath, "#!/usr/bin/env node\n", "utf8");
      await chmod(scriptPath, 0o755);
      const packageJsonPath = join(packageDir, "package.json");
      await writeFile(
        packageJsonPath,
        JSON.stringify({ version: "1.0.0" }),
        "utf8"
      );

      // Pin the script's mtime to a whole-second epoch boundary up front, so
      // "held constant" means the filesystem never has anything but this
      // exact value to report -- no read-back-and-reapply round trip through
      // utimes() is needed (real filesystems can report sub-millisecond
      // mtimes that a naive re-apply loses, which made this assertion flaky
      // before this fix).
      const fixedMtime = new Date(1_700_000_000_000);
      await utimes(scriptPath, fixedMtime, fixedMtime);

      const before = await resolveAgentControllerCommandFingerprint({
        commandPath: scriptPath,
        launchContractKind: "node_script",
      });

      // Only the vendored package's declared version changes underneath the
      // script -- this is the edge case the fingerprint's mtime/size signal
      // alone cannot see.
      await writeFile(
        packageJsonPath,
        JSON.stringify({ version: "2.0.0" }),
        "utf8"
      );

      const after = await resolveAgentControllerCommandFingerprint({
        commandPath: scriptPath,
        launchContractKind: "node_script",
      });

      expect(before?.mtimeMs).toBe(fixedMtime.getTime());
      expect(before?.mtimeMs).toBe(after?.mtimeMs);
      expect(before?.size).toBe(after?.size);
      expect(before?.packageJsonVersion).toBe("1.0.0");
      expect(after?.packageJsonVersion).toBe("2.0.0");
      expect(before).not.toEqual(after);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });
});

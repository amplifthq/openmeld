import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES } from "../src/agents/builtin-agent-controller-definitions";
import { probeAgentControllerUsageObservationAuth } from "../src/local-service/inventory/agent-controller-interface";
import {
  buildAgentControllerInterfaceKeeperKey,
  readLastKnownAgentControllerUsageLimits,
  recordAgentControllerInterfaceProbeSuccess,
  resetAgentControllerInterfaceKeeperForTests,
  resolveAgentControllerCommandFingerprint,
} from "../src/local-service/inventory/agent-controller-interface-keeper";
import { recordRuntimeProviderUsageLimits } from "../src/local-service/inventory/runtime-provider-usage-limits";

const temporaryDirectories: string[] = [];

beforeEach(() => {
  resetAgentControllerInterfaceKeeperForTests();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe("runtime provider usage-limit observations", () => {
  it("retains a passive event in the same fingerprinted ACI keeper", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openmeld-claude-usage-"));
    temporaryDirectories.push(directory);
    const commandPath = join(directory, "claude");
    await writeFile(
      commandPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
        '  printf \'%s\\n\' \'{"loggedIn":true,"email":"owner@example.com"}\'',
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      "utf8"
    );
    await chmod(commandPath, 0o755);
    const launchContract = { commandPath, kind: "executable" } as const;
    const fingerprint = await resolveAgentControllerCommandFingerprint({
      commandPath,
      launchContractKind: launchContract.kind,
    });
    expect(fingerprint).not.toBeNull();
    if (!fingerprint) {
      throw new Error("expected a command fingerprint");
    }
    const keeperKey = buildAgentControllerInterfaceKeeperKey({
      agentId: "claude-code",
      commandPath,
    });
    recordAgentControllerInterfaceProbeSuccess({
      commandFingerprint: fingerprint,
      keeperKey,
      nowMs: Date.now(),
      snapshot: createSnapshot(commandPath),
    });
    const usageLimits = [
      {
        key: "claude-code:five-hour",
        label: "5-hour usage limit",
        observedAt: "2026-08-20T10:00:00.000Z",
        resetsAt: "2026-08-20T12:00:00.000Z",
        status: "available" as const,
        usedPercent: 86,
      },
    ];
    const authSnapshot = await probeAgentControllerUsageObservationAuth({
      agentId: "claude-code",
      launchContract,
    });
    expect(authSnapshot).toEqual({
      email: "owner@example.com",
      label: "owner@example.com",
      status: "authenticated",
      type: "claude",
    });

    await expect(
      recordRuntimeProviderUsageLimits({
        agentId: "claude-code",
        authSnapshot,
        launchContract,
        usageLimits,
      })
    ).resolves.toBe(true);
    expect(
      readLastKnownAgentControllerUsageLimits({
        commandFingerprint: fingerprint,
        keeperKey,
      })
    ).toEqual(usageLimits);
  });
});

function createSnapshot(commandPath: string): AgentControllerInterfaceSnapshot {
  return {
    agentControllerRef: "builtin:claude-code",
    auth: {
      email: "owner@example.com",
      label: "Signed in",
      status: "authenticated",
    },
    capabilities: EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES,
    check: {
      lastSucceededAt: "2026-08-20T09:59:00.000Z",
      status: "succeeded",
    },
    checkedAt: "2026-08-20T09:59:00.000Z",
    controllerId: "claude-code",
    displayName: "Claude Code",
    launch: {
      argsPrefix: [],
      commandPath,
      installChoiceCount: 0,
      status: "ready",
    },
    message: null,
    models: [],
    nativeInterface: "claude-agent-sdk",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    usageLimits: [
      {
        key: "provider",
        label: "Usage limits",
        observedAt: "2026-08-20T09:59:00.000Z",
        resetsAt: null,
        status: "unavailable",
        usedPercent: null,
      },
    ],
    version: "2.1.237",
  };
}

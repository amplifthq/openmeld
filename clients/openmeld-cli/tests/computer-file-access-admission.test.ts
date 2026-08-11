import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterInteractionRequest } from "@openmeld/adapter-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveComputerFileAccessAdmission } from "../src/local-service/file-access/computer-file-access-admission";
import {
  applyComputerFileAccessAwareness,
  COMPUTER_FILE_ACCESS_AWARENESS,
} from "../src/local-service/file-access/computer-file-access-prompt";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-file-access-admission-"));
  tempDirs.push(path);
  return await realpath(path);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { force: true, recursive: true });
    })
  );
});

describe("Computer file access admission", () => {
  it("adds path-free agent awareness only when the Computer boundary is active", () => {
    const promptPlan = {
      developerInstructions: "Developer contract",
      fallbackPrompt: "Fallback prompt",
      instructionEpoch: "instructions-v1:old",
      userPrompt: "User prompt",
    };
    const active = applyComputerFileAccessAwareness({
      policy: {
        folders: ["/Users/felix/Secrets"],
        mode: "block_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
      promptPlan,
    });

    expect(active.developerInstructions).toContain(
      COMPUTER_FILE_ACCESS_AWARENESS
    );
    expect(active.fallbackPrompt).toContain(COMPUTER_FILE_ACCESS_AWARENESS);
    expect(active.userPrompt).toBe("User prompt");
    expect(active.instructionEpoch).not.toBe(promptPlan.instructionEpoch);
    expect(JSON.stringify(active)).not.toContain("/Users/felix/Secrets");
    expect(
      applyComputerFileAccessAwareness({
        policy: {
          mode: "local_agent_settings",
          revision: 1,
          updatedAtMs: 0,
        },
        promptPlan,
      })
    ).toBe(promptPlan);
  });

  it("leaves default local-agent behavior unchanged", async () => {
    const onInteractionRequest = vi.fn();

    await expect(
      resolveComputerFileAccessAdmission({
        agentControllerPermissionMode: "codex:customConfig",
        agentControllerRef: "builtin:codex",
        onInteractionRequest,
        policy: {
          mode: "local_agent_settings",
          revision: 1,
          updatedAtMs: 0,
        },
        providerRuntimeWorkingDirectory: "/does/not/need/to/exist",
        transportMode: "codex-app-server",
      })
    ).resolves.toEqual({ boundary: null, bypassedForThisRun: false });
    expect(onInteractionRequest).not.toHaveBeenCalled();
  });

  it("automatically rejects a working folder outside the selected folders", async () => {
    const selectedFolder = await makeTempDir();
    const workingFolder = await makeTempDir();
    const onInteractionRequest = vi.fn();

    await expect(
      resolveComputerFileAccessAdmission({
        agentControllerRef: "builtin:codex",
        onInteractionRequest,
        policy: {
          folders: [selectedFolder],
          mode: "only_selected_folders",
          revision: 2,
          updatedAtMs: 100,
        },
        providerRuntimeWorkingDirectory: workingFolder,
        transportMode: "codex-app-server",
      })
    ).rejects.toMatchObject({
      code: "computer.file_access.working_directory_denied",
    });
    expect(onInteractionRequest).not.toHaveBeenCalled();
  });

  it("automatically rejects a working folder inside a blocked folder", async () => {
    const blockedFolder = await makeTempDir();
    const onInteractionRequest = vi.fn();

    await expect(
      resolveComputerFileAccessAdmission({
        agentControllerRef: "builtin:codex",
        onInteractionRequest,
        policy: {
          folders: [blockedFolder],
          mode: "block_selected_folders",
          revision: 2,
          updatedAtMs: 100,
        },
        providerRuntimeWorkingDirectory: blockedFolder,
        transportMode: "local-cli",
      })
    ).rejects.toMatchObject({
      code: "computer.file_access.working_directory_denied",
    });
    expect(onInteractionRequest).not.toHaveBeenCalled();
  });

  it("passes an active boundary to a supported Codex transport", async () => {
    const workingFolder = await makeTempDir();
    const policy = {
      folders: [workingFolder],
      mode: "only_selected_folders" as const,
      revision: 2,
      updatedAtMs: 100,
    };

    await expect(
      resolveComputerFileAccessAdmission({
        agentControllerPermissionMode: "codex:askForApproval",
        agentControllerRef: "builtin:codex",
        onInteractionRequest: vi.fn(),
        policy,
        providerRuntimeWorkingDirectory: workingFolder,
        transportMode: "codex-app-server",
        verifyBoundary: () => Promise.resolve(true),
      })
    ).resolves.toEqual({ boundary: policy, bypassedForThisRun: false });
  });

  it("asks once when enforcement cannot be verified and accepts an exact-run bypass", async () => {
    const workingFolder = await makeTempDir();
    const requests: AdapterInteractionRequest[] = [];

    const result = await resolveComputerFileAccessAdmission({
      agentControllerRef: "builtin:claude-code",
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          kind: "permission" as const,
          optionId: "run_once_without_computer_file_access_boundary",
        });
      },
      policy: {
        folders: [workingFolder],
        mode: "only_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
      providerRuntimeWorkingDirectory: workingFolder,
      transportMode: "acp",
    });

    expect(result).toEqual({ boundary: null, bypassedForThisRun: true });
    expect(requests).toEqual([
      {
        description:
          "OpenMeld can’t verify that this local agent can enforce this computer’s file access boundary. Run this Wake once without the boundary, or cancel it.",
        kind: "permission",
        options: [
          {
            intent: "allow_once",
            label: "Run once without this boundary",
            optionId: "run_once_without_computer_file_access_boundary",
          },
          {
            intent: "deny",
            label: "Cancel run",
            optionId: "cancel_computer_file_access_run",
          },
        ],
        subject: {
          resource: "Computer file access boundary",
          type: "additional_permissions",
        },
        title: "File access needs your decision",
      },
    ]);
  });

  it("cancels the Wake when the owner declines the exact-run bypass", async () => {
    const workingFolder = await makeTempDir();
    const blockedFolder = await makeTempDir();

    await expect(
      resolveComputerFileAccessAdmission({
        agentControllerRef: "builtin:claude-code",
        onInteractionRequest: async () => ({
          kind: "permission",
          optionId: "cancel_computer_file_access_run",
        }),
        policy: {
          folders: [blockedFolder],
          mode: "block_selected_folders",
          revision: 2,
          updatedAtMs: 100,
        },
        providerRuntimeWorkingDirectory: workingFolder,
        transportMode: "acp",
      })
    ).rejects.toMatchObject({ code: "computer.file_access.owner_cancelled" });
  });
});

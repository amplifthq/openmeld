import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterInteractionRequest } from "@openmeld/adapter-core";
import type { AgentInteractionResponse } from "@openmeld/schemas/types";
import { afterEach, expect, it, vi } from "vitest";
import {
  resolveRecoveredLedgerConversation,
  resolveWorkingFolderRecovery,
} from "../src/local-service/continuation/working-folder-recovery";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "openmeld-folder-choice-"))
  );
  roots.push(root);
  const previous = join(root, "previous");
  const selected = join(root, "selected");
  await Promise.all([mkdir(previous), mkdir(selected)]);
  const inspectSession = vi.fn(async () => ({
    directory: previous,
    sessionId: "retained-session",
  }));
  const onInteractionRequest =
    vi.fn<
      (_: AdapterInteractionRequest) => Promise<AgentInteractionResponse>
    >();
  return {
    previous,
    selected,
    root,
    inspectSession,
    onInteractionRequest,
    input: {
      agentControllerRef: "builtin:opencode",
      nativeSessionId: "retained-session",
      workingDirectory: selected,
      policy: {
        mode: "local_agent_settings" as const,
        revision: 1,
        updatedAtMs: 0,
      },
      inspectSession,
      onInteractionRequest,
    },
  };
}

function answer(optionId: string): AgentInteractionResponse {
  return {
    kind: "question",
    answers: [{ questionId: "working_folder_recovery", values: [optionId] }],
  };
}

it("keeps healthy Wakes silent, including two paths to the same directory", async () => {
  const f = await fixture();
  const alias = join(f.root, "alias");
  await symlink(f.previous, alias);
  await expect(
    resolveWorkingFolderRecovery({ ...f.input, workingDirectory: alias })
  ).resolves.toEqual({ workingDirectory: alias, startNewConversation: false });
  expect(f.onInteractionRequest).not.toHaveBeenCalled();
});

it("uses the verified previous folder only after an explicit choice and rechecks it", async () => {
  const f = await fixture();
  f.onInteractionRequest.mockResolvedValue(answer("use_previous_folder"));
  await expect(resolveWorkingFolderRecovery(f.input)).resolves.toEqual({
    workingDirectory: f.previous,
    startNewConversation: false,
  });
  expect(f.inspectSession).toHaveBeenCalledTimes(2);
  expect(f.onInteractionRequest).toHaveBeenCalledOnce();
});

it("starts fresh only on request, without reusing either old conversation source", async () => {
  const f = await fixture();
  f.onInteractionRequest.mockResolvedValue(answer("start_new_conversation"));
  await expect(resolveWorkingFolderRecovery(f.input)).resolves.toEqual({
    workingDirectory: f.selected,
    startNewConversation: true,
  });
  expect(
    resolveRecoveredLedgerConversation({
      startNewConversation: true,
      bindingConversationId: "old-binding",
      existingContextId: "old-ledger",
      currentExecutionState: null,
    })
  ).toEqual({
    bindingConversationId: null,
    existingContextId: null,
    currentExecutionState: null,
  });
});

it("does not offer or accept a previous folder outside the Computer policy", async () => {
  const f = await fixture();
  f.onInteractionRequest.mockImplementation((request) => {
    expect(
      request.kind === "question" &&
        request.questions[0]?.options.some(
          (option) => option.optionId === "use_previous_folder"
        )
    ).toBe(false);
    return Promise.resolve(answer("use_previous_folder"));
  });
  await expect(
    resolveWorkingFolderRecovery({
      ...f.input,
      policy: {
        mode: "only_selected_folders",
        folders: [f.selected],
        revision: 1,
        updatedAtMs: 0,
      },
    })
  ).rejects.toMatchObject({ code: "context.workspace_recovery_unanswered" });
});

it("can start fresh when the previous folder is missing", async () => {
  const f = await fixture();
  await rm(f.previous, { recursive: true });
  f.onInteractionRequest.mockResolvedValue(answer("start_new_conversation"));
  await expect(resolveWorkingFolderRecovery(f.input)).resolves.toMatchObject({
    startNewConversation: true,
  });
});

it("rejects a moved native session after the owner answers", async () => {
  const f = await fixture();
  f.onInteractionRequest.mockImplementation(() => {
    f.inspectSession.mockResolvedValue({
      directory: f.selected,
      sessionId: "retained-session",
    });
    return Promise.resolve(answer("use_previous_folder"));
  });
  await expect(resolveWorkingFolderRecovery(f.input)).rejects.toMatchObject({
    code: "context.workspace_recovery_changed",
  });
});

it.each([
  ["leave_task", "context.workspace_recovery_declined"],
  ["invented", "context.workspace_recovery_unanswered"],
])("does not execute after %s", async (choice, code) => {
  const f = await fixture();
  f.onInteractionRequest.mockResolvedValue(answer(choice));
  await expect(resolveWorkingFolderRecovery(f.input)).rejects.toMatchObject({
    code,
  });
  expect(f.inspectSession).toHaveBeenCalledOnce();
});

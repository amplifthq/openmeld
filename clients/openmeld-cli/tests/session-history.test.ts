import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SessionHistoryOperation,
  SessionHistoryRequester,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindProject,
  removeProjectConnection,
} from "../src/agent-activity/project-bindings";
import { updateComputerFileAccessPolicy } from "../src/local-service/file-access/computer-file-access-store";
import { projectCodexHistory } from "../src/local-service/session-history/codex-history-reader";
import { handleSessionHistoryFrame } from "../src/local-service/session-history/session-history-handler";
import { sessionHistoryStorePath } from "../src/local-service/session-history/session-history-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
const owner: SessionHistoryRequester = {
  requestRootId: "owner-request",
  ownerUserId: "owner",
  requesterUserId: "owner",
  readerProfileId: null,
  delegatorProfileId: null,
  spaceId: null,
  audience: "owner_private",
};
const read: SessionHistoryOperation = {
  operation: "read_session",
  projectId: "project",
  sessionId: "native-session",
  offset: 0,
  limit: 20,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openmeld-history-test-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  const connection = await bindProject({
    rootDir: root,
    organizationId: "org",
    projectId: "project",
    projectSlug: "test-project",
    repositoryFingerprint: null,
    repositoryPath: repo,
  });
  const readHistory = vi.fn(
    async ({
      authorizePath,
    }: {
      authorizePath: (path: string) => Promise<void>;
      sessionId: string;
    }) => {
      await authorizePath(repo);
      return {
        cwd: repo,
        messages: [
          {
            role: "user" as const,
            text: "PRIVATE_BODY_NEVER_PERSIST",
            truncated: false,
          },
        ],
        omittedNonMessageItems: false,
      };
    }
  );
  let sequence = 0;
  const send = async (request: SessionHistoryOperation, requester = owner) => {
    sequence += 1;
    return (
      await handleSessionHistoryFrame({
        deviceId: "device",
        ownerUserId: "owner",
        rootDir: root,
        computerFileAccessStorePath: join(root, "file-access.json"),
        readHistory,
        frame: {
          v: 1,
          code: "daemon.session_history.request",
          payload: {
            requestId: `request-${sequence}`,
            request: {
              expectedDeviceId: "device",
              organizationId: "org",
              requester,
              request,
            },
          },
        },
      })
    ).payload.result;
  };
  const enable = () =>
    send({
      operation: "update_settings",
      expectedRevision: 1,
      policy: {
        enabled: true,
        connections: [
          {
            projectId: "project",
            bindingGeneration: connection.bindingGeneration,
          },
        ],
      },
    });
  return { root, repo, connection, readHistory, send, enable };
}

describe("controlled session history", () => {
  it("starts disabled and never opens Codex before owner consent", async () => {
    const f = await fixture();
    expect(await f.send(read)).toMatchObject({ kind: "error", code: "denied" });
    expect(f.readHistory).not.toHaveBeenCalled();
  });
  it("allows bounded owner reads, with metadata-only owner-private audit", async () => {
    const f = await fixture();
    await f.enable();
    expect(await f.send(read)).toMatchObject({
      kind: "session",
      messages: [{ text: "PRIVATE_BODY_NEVER_PERSIST" }],
      nextOffset: null,
    });
    const path = sessionHistoryStorePath(f.root, "owner", "org");
    expect(await readFile(path, "utf8")).not.toContain(
      "PRIVATE_BODY_NEVER_PERSIST"
    );
    expect((await stat(path)).mode % 0o1000).toBe(0o600);
    expect(await f.send({ operation: "read_audit" })).toMatchObject({
      kind: "audit",
      entries: [{ outcome: "allowed", count: 1 }],
    });
    expect(
      await f.send(
        { operation: "read_audit" },
        { ...owner, readerProfileId: "agent" }
      )
    ).toMatchObject({ kind: "error", code: "denied" });
  });
  it("allows any verified owner-delegated reader but rejects another human root", async () => {
    const f = await fixture();
    await f.enable();
    for (const requester of [
      { ...owner, requesterUserId: "coworker", readerProfileId: "agent" },
    ]) {
      expect(await f.send(read, requester)).toMatchObject({
        kind: "error",
        code: "denied",
      });
    }
    expect(f.readHistory).not.toHaveBeenCalled();
    for (const readerProfileId of ["agent", "new-agent"]) {
      expect(
        await f.send(read, {
          ...owner,
          readerProfileId,
          audience: "space",
          spaceId: "space",
        })
      ).toMatchObject({ kind: "session", requester: { audience: "space" } });
    }
  });
  it("requires fresh consent when upgrading per-Agent grants to all delegated agents", async () => {
    const f = await fixture();
    await f.enable();
    const path = sessionHistoryStorePath(f.root, "owner", "org");
    const saved = JSON.parse(await readFile(path, "utf8"));
    await writeFile(
      path,
      JSON.stringify({
        ...saved,
        version: 1,
        policy: { ...saved.policy, readerProfileIds: ["agent"] },
      })
    );
    const settings = await f.send({ operation: "read_settings" });
    expect(settings).toMatchObject({
      kind: "settings",
      policy: { enabled: false, revision: 3 },
    });
    expect(
      await f.send(read, { ...owner, readerProfileId: "agent" })
    ).toMatchObject({ kind: "error", code: "denied" });
    expect(f.readHistory).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 2,
      policy: { enabled: false },
    });
  });
  it("does not inherit consent when a Project is removed and reconnected", async () => {
    const f = await fixture();
    await f.enable();
    await removeProjectConnection({
      rootDir: f.root,
      organizationId: "org",
      projectId: "project",
      expectedBindingGeneration: f.connection.bindingGeneration,
    });
    await bindProject({
      rootDir: f.root,
      organizationId: "org",
      projectId: "project",
      projectSlug: "test-project",
      repositoryFingerprint: null,
      repositoryPath: f.repo,
    });
    expect(await f.send(read)).toMatchObject({ kind: "error", code: "denied" });
  });
  it("rejects a result when the owner disables access during a provider read", async () => {
    const f = await fixture();
    await f.enable();
    f.readHistory.mockImplementationOnce(async ({ authorizePath }) => {
      await authorizePath(f.repo);
      await f.send({
        operation: "update_settings",
        expectedRevision: 2,
        policy: { enabled: false, connections: [] },
      });
      return {
        cwd: f.repo,
        messages: [
          {
            role: "user",
            text: "PRIVATE_BODY_NEVER_PERSIST",
            truncated: false,
          },
        ],
        omittedNonMessageItems: false,
      };
    });
    expect(await f.send(read)).toMatchObject({ kind: "error", code: "denied" });
  });
  it("does not bypass File access blocks within a Project", async () => {
    const f = await fixture();
    await f.enable();
    const blocked = join(f.repo, "private");
    await mkdir(blocked);
    await updateComputerFileAccessPolicy({
      storePath: join(f.root, "file-access.json"),
      expectedRevision: 1,
      idempotencyKey: "block",
      policy: { mode: "block_selected_folders", folders: [blocked] },
    });
    expect(await f.send(read)).toMatchObject({ kind: "error", code: "denied" });
  });
  it("enforces compare-and-swap on settings", async () => {
    const f = await fixture();
    await f.enable();
    expect(await f.enable()).toMatchObject({ kind: "error", code: "changed" });
  });
});

it("projects Codex messages without reasoning, commands, or attachments", () => {
  // Fields follow Codex 0.150.1 generated ThreadReadResponse / ThreadItem / UserInput.
  const result = projectCodexHistory(
    {
      thread: {
        id: "session",
        cwd: "/project",
        turns: [
          {
            id: "turn",
            items: [
              {
                type: "userMessage",
                id: "u",
                clientId: null,
                content: [
                  { type: "text", text: "Question", text_elements: [] },
                  { type: "localImage", path: "/private/image.png" },
                ],
              },
              {
                type: "agentMessage",
                id: "a",
                text: "Answer",
                phase: "final_answer",
                memoryCitation: null,
                delivery: null,
              },
              {
                type: "reasoning",
                id: "r",
                summary: ["PRIVATE_REASONING"],
                content: [],
              },
              {
                type: "commandExecution",
                id: "c",
                command: "PRIVATE_COMMAND",
                aggregatedOutput: "SECRET",
              },
            ],
          },
        ],
      },
    },
    "session"
  );
  expect(result.messages).toEqual([
    { role: "user", text: "Question", truncated: false },
    { role: "assistant", text: "Answer", truncated: false },
  ]);
  expect(result.omittedNonMessageItems).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(PRIVATE_PATTERN);
});

const PRIVATE_PATTERN = /SECRET|PRIVATE|image.png/;

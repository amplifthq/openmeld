import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { sessionHistoryResultFrameSchema } from "@openmeld/schemas";
import type {
  SessionHistoryRequestFrame,
  SessionHistoryResult,
} from "@openmeld/schemas/types";
import { resolveLocalProjectConnectionForPath } from "../../agent-activity/project-binding-resolution";
import { listProjectBindings } from "../../agent-activity/project-bindings";
import { isSameOrDescendantPath } from "../../lib/path-containment";
import { readComputerFileAccessPolicy } from "../file-access/computer-file-access-store";
import { readSessionHistory } from "./history-reader";
import {
  appendSessionHistoryAudit,
  readSessionHistoryStore,
  sessionHistoryStorePath,
  updateSessionHistoryStore,
} from "./session-history-store";

class HistoryDenied extends Error {}
const denied = (): SessionHistoryResult => ({
  kind: "error",
  code: "denied",
  message: "This session is outside your authorized history access.",
});

export async function handleSessionHistoryFrame(input: {
  frame: SessionHistoryRequestFrame;
  deviceId: string;
  ownerUserId: string;
  computerFileAccessStorePath: string;
  rootDir?: string;
  readHistory?: typeof readSessionHistory;
}) {
  const { requestId, request: envelope } = input.frame.payload;
  const { request, requester, organizationId } = envelope;
  const path = sessionHistoryStorePath(
    dirname(input.computerFileAccessStorePath),
    input.ownerUserId,
    organizationId
  );
  let result: SessionHistoryResult;
  try {
    if (
      envelope.expectedDeviceId !== input.deviceId ||
      requester.ownerUserId !== input.ownerUserId ||
      requester.requesterUserId !== input.ownerUserId
    ) {
      throw new HistoryDenied();
    }
    if (
      request.operation !== "read_session" &&
      (requester.readerProfileId !== null ||
        requester.audience !== "owner_private")
    ) {
      throw new HistoryDenied();
    }
    result = await execute();
  } catch (error) {
    result =
      error instanceof HistoryDenied
        ? denied()
        : {
            kind: "error",
            code: "failed",
            message:
              "Conversation could not be read. Check the local agent on this computer, then try again.",
          };
    if (request.operation === "read_session") {
      // Never persist provider errors, source text, or tool output.
      await appendSessionHistoryAudit(
        path,
        audit(error instanceof HistoryDenied ? "denied" : "failed", 0)
      ).catch(() => undefined);
    }
  }
  return sessionHistoryResultFrameSchema.parse({
    v: 1,
    code: "daemon.session_history.request_result",
    payload: { requestId, result },
  });

  function audit(outcome: "allowed" | "denied" | "failed", count: number) {
    if (request.operation !== "read_session") {
      throw new HistoryDenied();
    }
    return {
      requestId,
      atMs: Date.now(),
      requester,
      projectId: request.projectId,
      provider: request.provider ?? "codex",
      sessionId: request.sessionId,
      offset: request.offset,
      outcome,
      count,
    };
  }
  async function saveSettings(
    request: Extract<
      SessionHistoryRequestFrame["payload"]["request"]["request"],
      { operation: "update_settings" }
    >,
    connections: Awaited<ReturnType<typeof listProjectBindings>>
  ) {
    const valid = request.policy.connections.every((grant) =>
      connections.some(
        (connection) =>
          connection.projectId === grant.projectId &&
          connection.bindingGeneration === grant.bindingGeneration
      )
    );
    if (!valid) {
      throw new HistoryDenied();
    }
    return await updateSessionHistoryStore(path, (current) => {
      if (current.policy.revision !== request.expectedRevision) {
        return null;
      }
      current.policy = {
        ...request.policy,
        revision: current.policy.revision + 1,
        updatedAtMs: Date.now(),
      };
      return current.policy;
    });
  }
  async function execute(): Promise<SessionHistoryResult> {
    const store = await readSessionHistoryStore(path);
    const connections = await listProjectBindings({
      rootDir: input.rootDir,
      organizationId,
    });
    const settings = () => ({
      kind: "settings" as const,
      policy: store.policy,
      connections: connections.map(
        ({ projectId, bindingGeneration, projectSlug }) => ({
          projectId,
          bindingGeneration,
          projectSlug,
        })
      ),
    });
    if (request.operation === "read_settings") {
      return settings();
    }
    if (request.operation === "read_audit") {
      return { kind: "audit", entries: store.entries };
    }
    if (request.operation === "update_settings") {
      const updated = await saveSettings(request, connections);
      if (!updated) {
        return {
          kind: "error",
          code: "changed",
          message: "History settings changed. Reload them before saving.",
        };
      }
      store.policy = updated;
      return settings();
    }
    const revision = store.policy.revision;
    const authorizePath = async (cwd: string) => {
      const current = await readSessionHistoryStore(path);
      if (!current.policy.enabled || current.policy.revision !== revision) {
        throw new HistoryDenied();
      }
      const bindings = await listProjectBindings({ rootDir: input.rootDir });
      const binding = await resolveLocalProjectConnectionForPath({
        path: cwd,
        connections: bindings,
      });
      if (
        !binding ||
        binding.organizationId !== organizationId ||
        binding.projectId !== request.projectId ||
        !current.policy.connections.some(
          (grant) =>
            grant.projectId === binding.projectId &&
            grant.bindingGeneration === binding.bindingGeneration
        )
      ) {
        throw new HistoryDenied();
      }
      const canonical = await realpath(cwd);
      const files = await readComputerFileAccessPolicy(
        input.computerFileAccessStorePath
      );
      if (files.mode === "local_agent_settings") {
        return;
      }
      const folders = await Promise.all(
        files.folders.map((folder) => realpath(folder))
      );
      // A block within the Project can contain text quoted in its session, so
      // reject both ancestor and descendant overlap rather than bypass it.
      const permitted =
        files.mode === "only_selected_folders"
          ? folders.some((folder) => isSameOrDescendantPath(canonical, folder))
          : !folders.some(
              (folder) =>
                isSameOrDescendantPath(canonical, folder) ||
                isSameOrDescendantPath(folder, binding.repositoryPath)
            );
      if (!permitted) {
        throw new HistoryDenied();
      }
    };
    if (!store.policy.enabled) {
      throw new HistoryDenied();
    }
    const history = await (input.readHistory ?? readSessionHistory)({
      provider: request.provider,
      sessionId: request.sessionId,
      authorizePath,
    });
    await authorizePath(history.cwd);
    const messages = history.messages.slice(
      request.offset,
      request.offset + request.limit
    );
    if (
      !(await appendSessionHistoryAudit(
        path,
        audit("allowed", messages.length),
        revision
      ))
    ) {
      return denied();
    }
    return {
      kind: "session",
      provider: request.provider ?? "codex",
      sessionId: request.sessionId,
      requester,
      messages,
      nextOffset:
        request.offset + messages.length < history.messages.length
          ? request.offset + messages.length
          : null,
      omittedNonMessageItems: history.omittedNonMessageItems,
    };
  }
}

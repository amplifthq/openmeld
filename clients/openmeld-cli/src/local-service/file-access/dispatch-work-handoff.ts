import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createOrganizationSkillsApi,
  createSpaceApi,
} from "@openmeld/api-client";
import { spaceWorkSelectionSchema } from "@openmeld/schemas";
import { getAuthSessionState } from "../../config/auth-session";
import { resolveBaseUrl } from "../../config/base-url";
import { buildOpenMeldRequestContextFromProfileIdentity } from "../../config/openmeld-request-context";
import { resolveOpenMeldRootDir } from "../../config/paths";
import { materializeOrganizationSkillRelease } from "../../organization-skills/cache";
import { createCliApiClientFoundation } from "../../space/api-client-foundation";
import { downloadWorkingCopyFile } from "../../space/working-copy-download";
import type { ParsedDispatchTask } from "../core/types";
import { createSpaceWorkingCopies } from "./space-working-copy";

/** The admitted Service prepares inputs; no login state is copied into the workspace. */
export async function prepareDispatchWorkHandoff(input: {
  task: Pick<
    ParsedDispatchTask,
    | "workHandoff"
    | "workingCopyId"
    | "executionContext"
    | "agentControllerRef"
    | "transportMode"
    | "targetProfileId"
    | "targetProfileName"
    | "spaceId"
    | "spacePassword"
    | "taskId"
    | "prompt"
  >;
  ownerUserId: string;
  workingDirectory: string;
}) {
  const { task } = input;
  if (!task.workHandoff) {
    return input.workingDirectory;
  }
  const context = requireHandoffContext(task);
  const codeHandoff =
    task.workHandoff.schemaVersion === 2 ? task.workHandoff : null;
  if (codeHandoff) {
    task.prompt += `\n\nCode handoff brief (public source ${codeHandoff.sourceSignalId}, exact commit ${codeHandoff.code.commit}):\n${JSON.stringify(codeHandoff.work)}\nReturn implementation evidence and verification through the existing Space reply action. No sender-local paths or private conversation are available.`;
  }
  const organizationId = context.scope.organizationId;
  const baseUrl = await resolveBaseUrl();
  const laneRoot = resolveOpenMeldRootDir();
  const assertCurrentIdentity = async () => {
    const auth = await getAuthSessionState({ validateRemote: false });
    if (
      auth.session?.user?.id !== input.ownerUserId ||
      auth.session?.activeOrganization?.id !== organizationId
    ) {
      throw new Error(
        "The account or Organization changed before handoff preparation."
      );
    }
  };
  await assertCurrentIdentity();
  // Only the code manifest permits an empty file selection.
  if (task.workHandoff.files.length === 0) {
    return input.workingDirectory;
  }
  const requestContext = buildOpenMeldRequestContextFromProfileIdentity({
    profileIdentity: {
      openMeldProfileId: task.targetProfileId,
      profileKind: "agent",
      ownerUserId: input.ownerUserId,
      profileName: task.targetProfileName ?? task.targetProfileId,
    },
  });
  const foundation = createCliApiClientFoundation(baseUrl, {
    expectedOwnerUserId: input.ownerUserId,
    organizationId,
  });
  const api = createSpaceApi(foundation);
  const common = {
    spaceId: task.spaceId,
    requestContext,
    ...(task.spacePassword ? { spacePassword: task.spacePassword } : {}),
  };
  const copies = createSpaceWorkingCopies({
    laneRoot,
    scope: {
      accountId: input.ownerUserId,
      organizationId,
      spaceId: task.spaceId,
      profileId: task.targetProfileId,
      baseUrl,
    },
    assertCurrentIdentity,
    transport: {
      read: (fileId, revision) =>
        downloadWorkingCopyFile(api, { ...common, fileId, revision }),
      get: async (fileId) => (await api.getFile({ ...common, fileId })).file,
      write: async (write) =>
        await api.updateFileContent({ ...common, ...write }),
    },
  });
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        baseUrl,
        input.ownerUserId,
        organizationId,
        task.spaceId,
        task.targetProfileId,
        task.taskId,
      ])
    )
    .digest("hex");
  const records = join(laneRoot, "space-work-dispatches");
  await mkdir(records, { recursive: true, mode: 0o700 });
  const recordPath = join(records, `${key}.json`);
  let copyId: string;
  let root: string;
  const stored = await readFile(recordPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  if (stored) {
    const record = JSON.parse(stored) as {
      copyId: string;
      root: string;
    };
    copyId = record.copyId;
    const status = await copies.resume(copyId);
    root = status.root;
    if (
      root !== record.root ||
      root !== join(input.workingDirectory, `handoff-${copyId}`)
    ) {
      throw new Error("The handoff workspace identity changed.");
    }
  } else {
    // The existing dispatch owner serializes execution. This private record is
    // published only after preparation; partial directories are never reused.
    copyId = randomUUID();
    root = join(input.workingDirectory, `handoff-${copyId}`);
    await copies.prepare(
      spaceWorkSelectionSchema.parse({
        schemaVersion: 1,
        files: task.workHandoff.files,
      }),
      root,
      copyId
    );
    await writeFile(recordPath, JSON.stringify({ copyId, root }), {
      flag: "wx",
      mode: 0o600,
    });
  }
  const skillsRoot = join(root, ".openmeld-skills");
  if (task.workHandoff.skills.length) {
    await mkdir(skillsRoot, { recursive: true, mode: 0o700 });
    if ((await lstat(skillsRoot)).isSymbolicLink()) {
      throw new Error("The Skill directory was replaced by a symbolic link.");
    }
  }
  const skills = createOrganizationSkillsApi(foundation);
  for (const [index, selected] of task.workHandoff.skills.entries()) {
    await assertCurrentIdentity();
    const result = await skills.get({ ...selected, requestContext });
    const release = result.selectedRelease;
    if (
      !release ||
      result.skill.organizationId !== organizationId ||
      !result.skill.enabled ||
      release.releaseId !== selected.releaseId ||
      release.digest !== selected.digest ||
      release.bundle.portable.name !== selected.name
    ) {
      throw new Error(
        "The selected Skill release is unavailable or changed. No latest-version fallback is allowed."
      );
    }
    await materializeOrganizationSkillRelease({
      ...selected,
      organizationId,
      bundle: release.bundle,
      releaseDirectory: join(skillsRoot, String(index)),
    });
  }
  await assertCurrentIdentity();
  await copies.status(copyId);
  task.workingCopyId = copyId;
  task.prompt += codeHandoff
    ? `\n\nSelected shared files are prepared under ${root}. Keep code work in the repository working directory. Use working_copy for saving shared-file revisions and the ordinary reply action for the result.`
    : "\n\nThe selected inputs are prepared in your working directory. Selected Skills (including resources) are in .openmeld-skills/<selection index>/SKILL.md. Use the working_copy tool to check, commit or reconcile your edits; it does not complete this Wake. Attach the exact saved file references with the reply tool when delivering results.";
  return codeHandoff ? input.workingDirectory : root;
}

function requireHandoffContext(
  task: Parameters<typeof prepareDispatchWorkHandoff>[0]["task"]
) {
  const context = task.executionContext;
  const handoff = task.workHandoff;
  if (!(context && handoff)) {
    throw new Error("execution_context.handoff_context_required");
  }
  if (handoff.schemaVersion === 2) {
    if (
      context.projectWork?.projectId !== handoff.code.projectId ||
      context.projectWork.repositoryFingerprint !==
        handoff.code.repositoryFingerprint ||
      context.projectWork.commit !== handoff.code.commit ||
      context.workspace !== handoff.execution.workspace ||
      (handoff.execution.access
        ? context.access !== handoff.execution.access ||
          context.permissionSource === "agent_settings"
        : context.permissionSource !== "agent_settings") ||
      !(
        task.agentControllerRef === "builtin:codex" ||
        task.agentControllerRef === "builtin:claude-code"
      )
    ) {
      throw new Error("execution_context.code_handoff_mismatch");
    }
  } else if (
    context.access !== "space_context" ||
    task.agentControllerRef !== "builtin:codex" ||
    task.transportMode !== "codex-app-server"
  ) {
    throw new Error(
      "Selected-file handoffs require a new Space-only context on Codex App Server. This controller cannot enforce that boundary."
    );
  }
  return context;
}

import {
  type DefineSkillOptions,
  defineSkill,
  type SkillReference,
} from "@flue/runtime";
import {
  organizationSkillRuntimeSnapshotResponseSchema,
  stringifyOrganizationSkillBundleCanonicalJson,
} from "@openmeld/schemas";
import type {
  OrganizationSkillFile,
  OrganizationSkillRuntimeRelease,
  OrganizationSkillRuntimeReleaseSelection,
} from "@openmeld/schemas/types";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";

export async function materializeOrganizationSkillFlueSkills(input: {
  expectedOrganizationId: string;
  selections: readonly OrganizationSkillRuntimeReleaseSelection[];
  snapshot: unknown;
}): Promise<SkillReference[]> {
  const snapshot = organizationSkillRuntimeSnapshotResponseSchema.parse(
    input.snapshot
  );
  if (snapshot.organizationId !== input.expectedOrganizationId) {
    throw new Error(
      "Organization Skill runtime snapshot belongs to another Organization."
    );
  }
  if (snapshot.releases.length !== input.selections.length) {
    throw new Error(
      "Organization Skill runtime snapshot does not match the frozen release selection."
    );
  }

  const releasesByIdentity = new Map<string, OrganizationSkillRuntimeRelease>();
  for (const release of snapshot.releases) {
    const key = buildReleaseIdentity(release);
    if (releasesByIdentity.has(key)) {
      throw new Error(
        "Organization Skill runtime snapshot contains a duplicate release."
      );
    }
    releasesByIdentity.set(key, release);
  }

  const skillNames = new Set<string>();
  const skills: SkillReference[] = [];
  for (const selection of input.selections) {
    if (skillNames.has(selection.name)) {
      throw new Error(
        "Organization Skill runtime selection contains a duplicate Skill name."
      );
    }
    skillNames.add(selection.name);

    const release = releasesByIdentity.get(buildReleaseIdentity(selection));
    if (!release) {
      throw new Error(
        `Organization Skill release ${selection.releaseId} is unavailable.`
      );
    }
    if (release.digest !== selection.digest) {
      throw new Error(
        `Organization Skill release ${selection.releaseId} changed after admission.`
      );
    }
    if (release.bundle.portable.name !== selection.name) {
      throw new Error(
        `Organization Skill release ${selection.releaseId} has a mismatched name.`
      );
    }
    const actualDigest = await sha256Hex(
      stringifyOrganizationSkillBundleCanonicalJson(release.bundle)
    );
    if (actualDigest !== selection.digest) {
      throw new Error(
        `Organization Skill release ${selection.releaseId} failed its integrity check.`
      );
    }

    skills.push(defineSkill(buildFlueSkillDefinition(release, selection.name)));
    releasesByIdentity.delete(buildReleaseIdentity(selection));
  }
  if (releasesByIdentity.size > 0) {
    throw new Error(
      "Organization Skill runtime snapshot contains an unexpected release."
    );
  }
  return skills;
}

export async function recordOrganizationSkillActivation(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  skillName: string;
}): Promise<boolean> {
  const release = input.context.organizationSkillReleases?.find(
    (candidate) => candidate.name === input.skillName
  );
  if (!release) {
    console.warn("[remote_agent.organization_skill.activation_unmatched]", {
      organizationId: input.context.organizationId,
      skillName: input.skillName,
      submissionId: input.context.submissionId,
    });
    return false;
  }
  try {
    await callCoreRpc(
      input.coreWorker,
      "recordOrganizationSkillActivation",
      {
        context: buildRemoteAgentCoreContext(
          input.context,
          `remote-agent-skill-activation:${input.context.submissionId}:${release.skillId}`
        ),
        digest: release.digest,
        releaseId: release.releaseId,
        routineRunId:
          input.context.turnEnvelope?.trigger.source === "routine"
            ? input.context.turnEnvelope.trigger.runId
            : null,
        skillId: release.skillId,
        submissionId: input.context.submissionId,
      },
      (binding, rpcInput) =>
        binding.recordOrganizationSkillActivation?.(rpcInput)
    );
    return true;
  } catch (error) {
    console.warn("[remote_agent.organization_skill.activation_record_failed]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId: input.context.organizationId,
      releaseId: release.releaseId,
      skillId: release.skillId,
      submissionId: input.context.submissionId,
    });
    return false;
  }
}

export function buildFlueSkillDefinition(
  release: OrganizationSkillRuntimeRelease,
  name: string
): DefineSkillOptions {
  const { portable } = release.bundle;
  return {
    ...(portable.compatibility
      ? { compatibility: portable.compatibility }
      : {}),
    description: portable.description,
    files: Object.fromEntries(
      release.bundle.files.map((file) => [file.path, decodeSkillFile(file)])
    ),
    instructions: release.bundle.instructions,
    ...(portable.license ? { license: portable.license } : {}),
    metadata: portable.metadata,
    name,
  };
}

function decodeSkillFile(file: OrganizationSkillFile): string | Uint8Array {
  if (file.encoding === "utf8") {
    return file.content;
  }
  const decoded = atob(file.content);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function buildReleaseIdentity(input: {
  releaseId: string;
  skillId: string;
}): string {
  return `${input.skillId}\0${input.releaseId}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

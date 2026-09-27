import { defineSkill, type SkillDefinition } from "@flue/runtime";
import {
  organizationSkillRuntimeCatalogResponseSchema,
  readOrganizationSkillRuntimeResourceResponseSchema,
} from "@openmeld/schemas";
import type { OrganizationSkillRuntimeReleaseSelection } from "@openmeld/schemas/types";
import {
  maxLength,
  minLength,
  parse,
  pipe,
  strictObject,
  string,
} from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";

const readSkillResourceInputSchema = strictObject({
  path: pipe(string(), minLength(1), maxLength(1024)),
  skillName: pipe(string(), minLength(1), maxLength(64)),
});

export function createOrganizationSkillResourceTool(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
}): RemoteAgentToolDefinition {
  return {
    name: "openmeld_read_skill_resource",
    description:
      "Read one resource from a Skill enabled for this Agent's current task. Pass the Skill name and exact relative resource path listed in its activated instructions. Reads the pinned version with current Team permissions.",
    input: readSkillResourceInputSchema,
    execute: async (payload) => {
      const request = parse(readSkillResourceInputSchema, payload);
      const release = input.context.organizationSkillReleases?.find(
        (candidate) => candidate.name === request.skillName
      );
      if (!release) {
        throw new Error("The selected Skill is not available in this task.");
      }
      const response = await callCoreRpc(
        input.coreWorker,
        "readOrganizationSkillRuntimeResource",
        {
          context: buildRemoteAgentCoreContext(
            input.context,
            `remote-agent-skill-resource:${input.context.submissionId}:${release.skillId}`
          ),
          path: request.path,
          ...(input.context.conversationIdentity?.kind === "personal_agent"
            ? { preparationIdempotencyKey: input.context.idempotencyKey }
            : {}),
          release,
        },
        (binding, rpcInput) =>
          binding.readOrganizationSkillRuntimeResource?.(rpcInput)
      );
      return readOrganizationSkillRuntimeResourceResponseSchema.parse(response);
    },
  };
}

export function materializeOrganizationSkillFlueSkillsFromCatalog(input: {
  expectedOrganizationId: string;
  selections: readonly OrganizationSkillRuntimeReleaseSelection[];
  catalog: unknown;
}): SkillDefinition[] {
  const catalog = organizationSkillRuntimeCatalogResponseSchema.parse(
    input.catalog
  );
  if (
    catalog.organizationId !== input.expectedOrganizationId ||
    catalog.releases.length !== input.selections.length
  ) {
    throw new Error(
      "Organization Skill catalog does not match the admitted task."
    );
  }
  const releasesByIdentity = new Map(
    catalog.releases.map((release) => [buildReleaseIdentity(release), release])
  );
  if (releasesByIdentity.size !== catalog.releases.length) {
    throw new Error("Organization Skill catalog contains a duplicate release.");
  }
  return input.selections.map((selection) => {
    const release = releasesByIdentity.get(buildReleaseIdentity(selection));
    if (
      !release ||
      release.digest !== selection.digest ||
      release.portable.name !== selection.name
    ) {
      throw new Error(
        `Organization Skill release ${selection.releaseId} does not match the admitted task.`
      );
    }
    releasesByIdentity.delete(buildReleaseIdentity(selection));
    const resources = release.files
      .map((file) => `- ${file.path} (${file.mediaType}, ${file.size} bytes)`)
      .join("\n");
    return defineSkill({
      name: selection.name,
      description: release.portable.description,
      instructions:
        resources.length > 0
          ? `${release.instructions}\n\nResources in this Skill version:\n${resources}\n\nRead a needed resource with openmeld_read_skill_resource using skillName="${selection.name}" and its exact path.`
          : release.instructions,
      ...(release.portable.compatibility
        ? { compatibility: release.portable.compatibility }
        : {}),
      ...(release.portable.license
        ? { license: release.portable.license }
        : {}),
      ...(Object.keys(release.portable.metadata).length > 0
        ? { metadata: release.portable.metadata }
        : {}),
    });
  });
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

function buildReleaseIdentity(input: {
  releaseId: string;
  skillId: string;
}): string {
  return `${input.skillId}\0${input.releaseId}`;
}

import {
  createOrganizationDocumentsApi,
  createOrganizationSkillsApi,
} from "@openmeld/api-client";
import type { OrganizationSkillRuntimeReleaseSelection } from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";
import { createCliApiClientFoundation } from "./api-client-foundation";
import { fetchSpaceMeta } from "./meta-api";

type TaskKnowledgeScope = {
  spaceId: string;
  targetProfileId: string;
  spacePassword?: string;
  onRead?: (read: {
    operation: "identity" | "space_metadata" | "documents" | "skills";
    durationMs: number;
    status: "loaded" | "failed";
  }) => void;
};

async function observeRead<T>(
  input: TaskKnowledgeScope,
  operation: Parameters<
    NonNullable<TaskKnowledgeScope["onRead"]>
  >[0]["operation"],
  read: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  let status: "loaded" | "failed" = "failed";
  try {
    const result = await read();
    status = "loaded";
    return result;
  } finally {
    input.onRead?.({
      operation,
      durationMs: Math.round(performance.now() - startedAt),
      status,
    });
  }
}

/** Share identity and Space scope only for this preparation, never across Wakes. */
export async function readTaskKnowledge(
  input: TaskKnowledgeScope & {
    skillSelections?: OrganizationSkillRuntimeReleaseSelection[];
  }
) {
  const { foundation, requestContext, spaceMeta } =
    await createTaskKnowledgeReader(input);
  const [documents, skills] = await Promise.all([
    observeRead(input, "documents", () =>
      createOrganizationDocumentsApi(foundation).list({ requestContext })
    )
      .then((result) => result.documents)
      .catch(() => null),
    input.skillSelections !== undefined
      ? Promise.resolve(input.skillSelections)
      : observeRead(input, "skills", () =>
          readSkillSelections({ foundation, requestContext })
        ).catch(() => null),
  ]);
  return { documents, skills, spaceMeta };
}

/** Existing member API, with the Agent identity and the Space's Organization. */
export async function readTaskDocuments(input: {
  spaceId: string;
  targetProfileId: string;
  documentId?: string;
}) {
  const { foundation, requestContext } = await createTaskKnowledgeReader(input);
  const api = createOrganizationDocumentsApi(foundation);
  return input.documentId
    ? await api.get({ requestContext, documentId: input.documentId })
    : await api.list({ requestContext });
}

async function createTaskKnowledgeReader(input: TaskKnowledgeScope) {
  const profile = await observeRead(input, "identity", () =>
    requireOpenMeldProfile({
      openMeldProfileId: input.targetProfileId,
      profileKind: "agent",
      persistSelection: false,
      authAction: "reading task documents",
    })
  );
  if (
    profile.openMeldProfileId !== input.targetProfileId ||
    profile.profileKind !== "agent"
  ) {
    throw new Error("The document reader does not match the current Agent.");
  }
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: profile,
  });
  const baseUrl = await resolveBaseUrl();
  const meta = await observeRead(input, "space_metadata", () =>
    fetchSpaceMeta({
      baseUrl,
      requestContext,
      space: input.spaceId,
      ...(input.spacePassword ? { password: input.spacePassword } : {}),
    })
  );
  return {
    spaceMeta: meta,
    requestContext,
    foundation: createCliApiClientFoundation(baseUrl, {
      organizationId: meta.organizationId,
    }),
  };
}

async function readSkillSelections({
  foundation,
  requestContext,
}: {
  foundation: ReturnType<typeof createCliApiClientFoundation>;
  requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
}): Promise<OrganizationSkillRuntimeReleaseSelection[]> {
  const result = await createOrganizationSkillsApi(foundation).list({
    requestContext,
  });
  return result.skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      skillId: skill.id,
      name: skill.name,
      releaseId: skill.activeRelease.id,
      digest: skill.activeRelease.digest,
    }));
}

export async function readDispatchSkill(input: {
  name?: string;
  env: NodeJS.ProcessEnv;
}) {
  const context = readDispatchSpaceActionContextFromEnv(input.env);
  const selections = context.organizationSkillReleases ?? [];
  const { foundation, requestContext } =
    await createTaskKnowledgeReader(context);
  const api = createOrganizationSkillsApi(foundation);
  if (!input.name) {
    const current = await api.list({ requestContext });
    const enabled = new Set(
      current.skills.filter((skill) => skill.enabled).map((skill) => skill.id)
    );
    return {
      skills: selections.filter((selection) => enabled.has(selection.skillId)),
    };
  }
  const selected = selections.filter((skill) => skill.name === input.name);
  if (!selected.length) {
    throw new Error("This Skill was not selected for the current task.");
  }
  const results = await Promise.all(
    selected.map(async (selection) => {
      const result = await api.get({ ...selection, requestContext });
      if (
        !(result.skill.enabled && result.selectedRelease) ||
        result.selectedRelease.digest !== selection.digest ||
        result.selectedRelease.releaseId !== selection.releaseId
      ) {
        throw new Error(
          "The selected Skill release is unavailable or changed."
        );
      }
      return { ...selection, bundle: result.selectedRelease.bundle };
    })
  );
  return { skills: results };
}

export async function readDispatchDocuments(input: {
  documentId?: string;
  env: NodeJS.ProcessEnv;
}) {
  const context = readDispatchSpaceActionContextFromEnv(input.env);
  return await readTaskDocuments({ ...context, documentId: input.documentId });
}

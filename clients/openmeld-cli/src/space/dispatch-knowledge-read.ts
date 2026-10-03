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

async function createTaskKnowledgeReader(input: {
  spaceId: string;
  targetProfileId: string;
}) {
  const profile = await requireOpenMeldProfile({
    openMeldProfileId: input.targetProfileId,
    profileKind: "agent",
    persistSelection: false,
    authAction: "reading task documents",
  });
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
  const meta = await fetchSpaceMeta({
    baseUrl,
    requestContext,
    space: input.spaceId,
  });
  return {
    requestContext,
    foundation: createCliApiClientFoundation(baseUrl, {
      organizationId: meta.organizationId,
    }),
  };
}

export async function readTaskSkillSelections(input: {
  spaceId: string;
  targetProfileId: string;
}): Promise<OrganizationSkillRuntimeReleaseSelection[]> {
  const { foundation, requestContext } = await createTaskKnowledgeReader(input);
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

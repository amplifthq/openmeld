import {
  createOrganizationSkillBodySchema,
  createOrganizationSkillResponseSchema,
  deleteOrganizationSkillBodySchema,
  deleteOrganizationSkillResponseSchema,
  getOrganizationSkillResponseSchema,
  importOrganizationSkillFromGitHubBodySchema,
  importOrganizationSkillFromGitHubResponseSchema,
  listOrganizationSkillsResponseSchema,
  organizationSkillRouteParamsSchema,
  previewOrganizationSkillFromGitHubBodySchema,
  previewOrganizationSkillFromGitHubResponseSchema,
  setOrganizationSkillEnabledBodySchema,
  setOrganizationSkillEnabledResponseSchema,
  setOrganizationSkillMaintainersBodySchema,
  setOrganizationSkillMaintainersResponseSchema,
  updateOrganizationSkillBodySchema,
  updateOrganizationSkillResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildOrganizationSkillEnabledPath,
  buildOrganizationSkillGitHubImportPath,
  buildOrganizationSkillGitHubPreviewPath,
  buildOrganizationSkillMaintainersPath,
  buildOrganizationSkillPath,
  buildOrganizationSkillsPath,
} from "./routes";
import type {
  CreateOrganizationSkillsApi,
  OrganizationSkillRequestInput,
} from "./types";

export const createOrganizationSkillsApi: CreateOrganizationSkillsApi = (
  client: OpenMeldApiClientFoundation
) => ({
  list: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Organization Skills response",
      method: "GET",
      operation: "organization_skill.list",
      schema: listOrganizationSkillsResponseSchema,
      url: buildOrganizationSkillsPath(),
    }),
  get: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Organization Skill response",
      method: "GET",
      operation: "organization_skill.get",
      schema: getOrganizationSkillResponseSchema,
      url: buildOrganizationSkillPath(requireSkillId(input.skillId)),
    }),
  create: async (input) => {
    const body = requireValidInput(
      createOrganizationSkillBodySchema,
      {
        description: input.description,
        expectedOrganizationId: input.expectedOrganizationId,
        instructions: input.instructions,
        name: input.name,
      },
      "Organization Skill create request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization Skill create response",
      method: "POST",
      operation: "organization_skill.create",
      schema: createOrganizationSkillResponseSchema,
      url: buildOrganizationSkillsPath(),
    });
  },
  importFromGitHub: async (input) => {
    const body = requireValidInput(
      importOrganizationSkillFromGitHubBodySchema,
      {
        ...(input.expectedCommitSha === undefined
          ? {}
          : { expectedCommitSha: input.expectedCommitSha }),
        expectedOrganizationId: input.expectedOrganizationId,
        url: input.url,
      },
      "Organization Skill GitHub import request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization Skill GitHub import response",
      method: "POST",
      operation: "organization_skill.import_github",
      schema: importOrganizationSkillFromGitHubResponseSchema,
      url: buildOrganizationSkillGitHubImportPath(),
    });
  },
  previewFromGitHub: async (input) => {
    const body = requireValidInput(
      previewOrganizationSkillFromGitHubBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        url: input.url,
      },
      "Organization Skill GitHub preview request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization Skill GitHub preview response",
      method: "POST",
      operation: "organization_skill.preview_github",
      schema: previewOrganizationSkillFromGitHubResponseSchema,
      url: buildOrganizationSkillGitHubPreviewPath(),
    });
  },
  update: async (input) => {
    const body = requireValidInput(
      updateOrganizationSkillBodySchema,
      {
        bundle: input.bundle,
        expectedActiveReleaseId: input.expectedActiveReleaseId,
        expectedOrganizationId: input.expectedOrganizationId,
        expectedVersion: input.expectedVersion,
      },
      "Organization Skill update request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization Skill update response",
      method: "PATCH",
      operation: "organization_skill.update",
      schema: updateOrganizationSkillResponseSchema,
      url: buildOrganizationSkillPath(requireSkillId(input.skillId)),
    });
  },
  setEnabled: async (input) => {
    const skillId = requireSkillId(input.skillId);
    const body = requireValidInput(
      setOrganizationSkillEnabledBodySchema,
      {
        enabled: input.enabled,
        expectedOrganizationId: input.expectedOrganizationId,
        expectedVersion: input.expectedVersion,
      },
      "Organization Skill enabled request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization Skill enabled response",
      method: "PATCH",
      operation: "organization_skill.set_enabled",
      schema: setOrganizationSkillEnabledResponseSchema,
      url: buildOrganizationSkillEnabledPath(skillId),
    });
  },
  setMaintainers: async (input) => {
    const skillId = requireSkillId(input.skillId);
    const body = requireValidInput(
      setOrganizationSkillMaintainersBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        expectedVersion: input.expectedVersion,
        maintainerUserIds: input.maintainerUserIds,
      },
      "Organization Skill maintainers request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization Skill maintainers response",
      method: "PUT",
      operation: "organization_skill.set_maintainers",
      schema: setOrganizationSkillMaintainersResponseSchema,
      url: buildOrganizationSkillMaintainersPath(skillId),
    });
  },
  delete: async (input) => {
    const body = requireValidInput(
      deleteOrganizationSkillBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        expectedVersion: input.expectedVersion,
      },
      "Organization Skill delete request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization Skill delete response",
      method: "DELETE",
      operation: "organization_skill.delete",
      schema: deleteOrganizationSkillResponseSchema,
      url: buildOrganizationSkillPath(requireSkillId(input.skillId)),
    });
  },
});

function requireSkillId(value: string): string {
  return requireValidInput(
    organizationSkillRouteParamsSchema,
    { skillId: value },
    "Organization Skill identifier is invalid."
  ).skillId;
}

function requestOptions(input: OrganizationSkillRequestInput) {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${message} ${parsed.error.issues[0]?.message ?? "Invalid input."}`
    );
  }
  return parsed.data;
}

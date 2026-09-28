import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { linearExternalWorkItemSchema } from "./space-tasks";

export const PROJECT_NAME_MAX_CHARS = 120;
export const PROJECT_SLUG_MAX_CHARS = 80;
export const ACTIVE_PROJECT_LIMIT = 500;

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const timestampMsSchema = z.number().int().nonnegative();
const LINEAR_ISSUE_CREATE_ACTION_ID = "linear.create_linear_issue";

export const repositoryFingerprintSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u);

export const repositoryUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        url.pathname !== "/"
      );
    } catch {
      return false;
    }
  }, "Repository URL must be a safe canonical HTTPS URL.");

export const projectSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_SLUG_MAX_CHARS)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const projectSchema = z.strictObject({
  archivedAtMs: timestampMsSchema.nullable(),
  canArchive: z.boolean(),
  canManage: z.boolean(),
  createdAtMs: timestampMsSchema,
  createdByUserId: boundedIdentifierSchema,
  id: boundedIdentifierSchema,
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_CHARS),
  organizationId: boundedIdentifierSchema,
  repositoryFingerprint: repositoryFingerprintSchema.nullable(),
  repositoryUrl: repositoryUrlSchema.nullable().optional(),
  slug: projectSlugSchema,
  updatedAtMs: timestampMsSchema,
});

export const createProjectBodySchema = z.strictObject({
  operationId: boundedIdentifierSchema.optional(),
  expectedOrganizationId: boundedIdentifierSchema,
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_CHARS),
  repositoryFingerprint: repositoryFingerprintSchema.optional(),
  repositoryUrl: repositoryUrlSchema.optional(),
  slug: projectSlugSchema.optional(),
});

export const listProjectsQuerySchema = z.strictObject({});

export const listProjectsResponseSchema = z.strictObject({
  organizationId: boundedIdentifierSchema,
  projects: z.array(projectSchema).max(ACTIVE_PROJECT_LIMIT),
});

export const createProjectResponseSchema = z.strictObject({
  project: projectSchema,
});

export const projectRouteParamsSchema = z.strictObject({
  projectId: boundedIdentifierSchema,
});

const githubRepositoryPartSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/u);

export const projectIssueDestinationSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("github"),
    owner: githubRepositoryPartSchema,
    repo: githubRepositoryPartSchema,
  }),
  z.strictObject({
    provider: z.literal("linear"),
    teamId: z.uuid(),
    projectId: z.uuid().optional(),
  }),
]);

export const projectIssueRoutingSchema = z.strictObject({
  projectId: boundedIdentifierSchema,
  destination: projectIssueDestinationSchema.nullable(),
  revision: z.number().int().nonnegative(),
  updatedAtMs: timestampMsSchema.nullable(),
  updatedByUserId: boundedIdentifierSchema.nullable(),
});

export const readProjectIssueRoutingResponseSchema = z.strictObject({
  routing: projectIssueRoutingSchema,
});

export const updateProjectIssueRoutingBodySchema = z.strictObject({
  expectedOrganizationId: boundedIdentifierSchema,
  expectedRevision: z.number().int().nonnegative(),
  destination: projectIssueDestinationSchema.nullable(),
});

export const updateProjectIssueRoutingResponseSchema =
  readProjectIssueRoutingResponseSchema;

export const resolveProjectIssueActionRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  proposedDestination: projectIssueDestinationSchema,
});

export const resolveProjectIssueActionResponseSchema = z.strictObject({
  basis: z.enum(["explicit_request", "project_default", "object_context"]),
  destination: projectIssueDestinationSchema,
  projectId: boundedIdentifierSchema.nullable(),
  projectRevision: z.number().int().nonnegative().nullable(),
});

const projectRepositoryUrlsSchema = z
  .array(repositoryUrlSchema)
  .max(12)
  .refine(
    (urls) =>
      new Set(urls.map((url) => url.toLowerCase())).size === urls.length,
    "Each repository can be associated only once."
  );

export const projectRepositorySettingsSchema = z.strictObject({
  projectId: boundedIdentifierSchema,
  repositories: z
    .array(
      z.strictObject({
        repositoryUrl: repositoryUrlSchema,
        repositoryFingerprint: repositoryFingerprintSchema,
        isDefault: z.boolean(),
      })
    )
    .max(12),
  legacyDefaultFingerprint: repositoryFingerprintSchema.nullable(),
  revision: z.number().int().nonnegative(),
  updatedAtMs: timestampMsSchema.nullable(),
  updatedByUserId: boundedIdentifierSchema.nullable(),
});

export const readProjectRepositorySettingsResponseSchema = z.strictObject({
  settings: projectRepositorySettingsSchema,
});

export const updateProjectRepositorySettingsBodySchema = z.strictObject({
  expectedOrganizationId: boundedIdentifierSchema,
  expectedRevision: z.number().int().nonnegative(),
  repositoryUrls: projectRepositoryUrlsSchema,
  defaultRepositoryUrl: repositoryUrlSchema.nullable(),
});

export const updateProjectRepositorySettingsResponseSchema =
  readProjectRepositorySettingsResponseSchema;

export const readProjectRepositorySettingsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema.optional(),
  projectId: boundedIdentifierSchema,
});
export const updateProjectRepositorySettingsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema.optional(),
  projectId: boundedIdentifierSchema,
  ...updateProjectRepositorySettingsBodySchema.shape,
});

const projectCommonAgentIdsSchema = z
  .array(boundedIdentifierSchema)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "An Agent can be listed only once.",
  });

export const projectCommonAgentsSchema = z.strictObject({
  projectId: boundedIdentifierSchema,
  agentProfileIds: projectCommonAgentIdsSchema,
  revision: z.number().int().nonnegative(),
  updatedAtMs: timestampMsSchema.nullable(),
  updatedByUserId: boundedIdentifierSchema.nullable(),
});

export const readProjectCommonAgentsResponseSchema = z.strictObject({
  commonAgents: projectCommonAgentsSchema,
});

export const updateProjectCommonAgentsBodySchema = z.strictObject({
  expectedOrganizationId: boundedIdentifierSchema,
  expectedRevision: z.number().int().nonnegative(),
  agentProfileIds: projectCommonAgentIdsSchema,
});

export const updateProjectCommonAgentsResponseSchema =
  readProjectCommonAgentsResponseSchema;

export const readProjectCommonAgentsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema.optional(),
  projectId: boundedIdentifierSchema,
});
export const updateProjectCommonAgentsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema.optional(),
  projectId: boundedIdentifierSchema,
  ...updateProjectCommonAgentsBodySchema.shape,
});

export function isLinearIssueCreateAction(actionId: string): boolean {
  return actionId === LINEAR_ISSUE_CREATE_ACTION_ID;
}

export function readLinearIssueReference(input: {
  actionInput: Record<string, unknown>;
  data: unknown;
}): z.infer<typeof linearExternalWorkItemSchema> | null {
  const issue =
    input.data && typeof input.data === "object" && !Array.isArray(input.data)
      ? (input.data as Record<string, unknown>)
      : null;
  if (!issue) {
    return null;
  }
  const parsed = linearExternalWorkItemSchema.safeParse({
    id: issue.id,
    identifier: issue.identifier,
    teamId: input.actionInput.team_id,
    ...(input.actionInput.project_id === undefined
      ? {}
      : { projectId: input.actionInput.project_id }),
    provider: "linear",
    url: issue.ticket_url,
    lastObservedAt: null,
    lastObservedState: null,
  });
  if (!parsed.success) {
    return null;
  }
  try {
    const url = new URL(parsed.data.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "linear.app" ||
      !url.pathname.split("/").includes(parsed.data.identifier)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return parsed.data;
}

export const readProjectIssueRoutingRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema.optional(),
  projectId: boundedIdentifierSchema,
});

export const updateProjectIssueRoutingRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema.optional(),
  projectId: boundedIdentifierSchema,
  ...updateProjectIssueRoutingBodySchema.shape,
});

const projectUpdateShape = {
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_CHARS).optional(),
  repositoryFingerprint: repositoryFingerprintSchema.nullable().optional(),
  repositoryUrl: repositoryUrlSchema.nullable().optional(),
  slug: projectSlugSchema.optional(),
};

const hasProjectUpdate = (value: {
  name?: string;
  repositoryFingerprint?: string | null;
  repositoryUrl?: string | null;
  slug?: string;
}) =>
  value.name !== undefined ||
  value.repositoryFingerprint !== undefined ||
  value.repositoryUrl !== undefined ||
  value.slug !== undefined;

export const updateProjectBodySchema = z
  .strictObject({
    expectedOrganizationId: boundedIdentifierSchema,
    ...projectUpdateShape,
  })
  .refine(hasProjectUpdate, "At least one Project field must be updated.");

export const updateProjectResponseSchema = z.strictObject({
  project: projectSchema,
});

export const archiveProjectBodySchema = z.strictObject({
  expectedOrganizationId: boundedIdentifierSchema,
});

export const archiveProjectResponseSchema = z.strictObject({
  project: projectSchema,
});

const projectRpcContextShape = {
  context: openMeldRequestContextSchema.optional(),
};

export const listProjectsRpcInputSchema = z.strictObject({
  ...projectRpcContextShape,
});

export const createProjectRpcInputSchema = z.strictObject({
  ...projectRpcContextShape,
  ...createProjectBodySchema.shape,
});

export const updateProjectRpcInputSchema = z
  .strictObject({
    ...projectRpcContextShape,
    expectedOrganizationId: boundedIdentifierSchema,
    ...projectRouteParamsSchema.shape,
    ...projectUpdateShape,
  })
  .refine(hasProjectUpdate, "At least one Project field must be updated.");

export const archiveProjectRpcInputSchema = z.strictObject({
  ...projectRpcContextShape,
  ...archiveProjectBodySchema.shape,
  ...projectRouteParamsSchema.shape,
});

import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";
import {
  PROJECT_NAME_MAX_CHARS,
  projectSlugSchema,
  repositoryUrlSchema,
} from "./projects";

export const CENTER_AGENT_PROJECT_LIST_MAX_LIMIT = 50;
export const CENTER_AGENT_PROJECT_OPERATION_ID_MAX_CHARS = 128;
export const CENTER_AGENT_PROJECT_QUERY_MAX_CHARS = 120;

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const operationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(CENTER_AGENT_PROJECT_OPERATION_ID_MAX_CHARS);
const timestampMsSchema = z.number().int().nonnegative();

export const centerAgentProjectSchema = z.strictObject({
  canArchive: z.boolean(),
  canManage: z.boolean(),
  id: boundedIdentifierSchema,
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_CHARS),
  repositoryUrl: repositoryUrlSchema.nullable(),
  slug: projectSlugSchema,
});

const centerAgentProjectToolContextShape = {
  context: openMeldRequestContextSchema,
  executionMode: z.enum(["interactive", "routine"]),
  speakerMember: centerAgentToolSpeakerSchema,
};

export const centerAgentListProjectsToolRpcInputSchema = z.strictObject({
  ...centerAgentProjectToolContextShape,
  limit: z
    .number()
    .int()
    .min(1)
    .max(CENTER_AGENT_PROJECT_LIST_MAX_LIMIT)
    .optional(),
  query: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_PROJECT_QUERY_MAX_CHARS)
    .optional(),
});

export const centerAgentListProjectsToolResponseSchema = z.strictObject({
  hasMore: z.boolean(),
  projects: z
    .array(centerAgentProjectSchema)
    .max(CENTER_AGENT_PROJECT_LIST_MAX_LIMIT),
});

export const centerAgentCreateProjectToolRpcInputSchema = z.strictObject({
  ...centerAgentProjectToolContextShape,
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_CHARS),
  operationId: operationIdSchema,
  repositoryUrl: repositoryUrlSchema.optional(),
  slug: projectSlugSchema.optional(),
});

export const centerAgentCreateProjectToolResponseSchema = z.strictObject({
  outcome: z.enum(["created", "replayed"]),
  project: centerAgentProjectSchema,
});

const centerAgentProjectUpdateShape = {
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_CHARS).optional(),
  repositoryUrl: repositoryUrlSchema.nullable().optional(),
  slug: projectSlugSchema.optional(),
};

const hasProjectUpdate = (value: {
  name?: string;
  repositoryUrl?: string | null;
  slug?: string;
}) =>
  value.name !== undefined ||
  value.repositoryUrl !== undefined ||
  value.slug !== undefined;

export const centerAgentUpdateProjectToolRpcInputSchema = z
  .strictObject({
    ...centerAgentProjectToolContextShape,
    operationId: operationIdSchema,
    projectId: boundedIdentifierSchema,
    ...centerAgentProjectUpdateShape,
  })
  .refine(hasProjectUpdate, "At least one Project field must be updated.");

export const centerAgentUpdateProjectToolResponseSchema = z.strictObject({
  outcome: z.enum(["replayed", "updated"]),
  project: centerAgentProjectSchema,
});

export const centerAgentSetAgentProfileDefaultProjectToolRpcInputSchema =
  z.strictObject({
    agentProfileId: boundedIdentifierSchema,
    ...centerAgentProjectToolContextShape,
    operationId: operationIdSchema,
    projectId: boundedIdentifierSchema.nullable(),
  });

export const centerAgentSetAgentProfileDefaultProjectToolResponseSchema =
  z.strictObject({
    agentProfile: z.strictObject({
      defaultProjectId: boundedIdentifierSchema.nullable(),
      id: boundedIdentifierSchema,
      name: z.string().trim().min(1).max(256),
    }),
    outcome: z.enum(["replayed", "updated"]),
    project: centerAgentProjectSchema.nullable(),
  });

export const centerAgentPrepareRemoveProjectToolRpcInputSchema = z.strictObject(
  {
    ...centerAgentProjectToolContextShape,
    projectId: boundedIdentifierSchema,
  }
);

export const centerAgentPrepareRemoveProjectToolResponseSchema = z.strictObject(
  {
    confirmation: z.strictObject({
      expiresAtMs: timestampMsSchema,
      token: z.string().trim().min(16).max(512),
    }),
    project: centerAgentProjectSchema,
    warning: z.string().trim().min(1).max(512),
  }
);

export const centerAgentRemoveProjectToolRpcInputSchema = z.strictObject({
  confirmationToken: z.string().trim().min(16).max(512),
  ...centerAgentProjectToolContextShape,
  operationId: operationIdSchema,
});

export const centerAgentRemoveProjectToolResponseSchema = z.strictObject({
  outcome: z.enum(["removed", "replayed"]),
  project: centerAgentProjectSchema,
});

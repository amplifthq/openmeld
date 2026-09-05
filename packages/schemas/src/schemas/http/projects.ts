import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

export const PROJECT_NAME_MAX_CHARS = 120;
export const PROJECT_SLUG_MAX_CHARS = 80;
export const ACTIVE_PROJECT_LIMIT = 500;

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const timestampMsSchema = z.number().int().nonnegative();

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

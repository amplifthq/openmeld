import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";

export const ORGANIZATION_SKILL_NAME_MAX_CHARS = 64;
export const ORGANIZATION_SKILL_DESCRIPTION_MAX_CHARS = 1024;
export const ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS = 100_000;
export const ORGANIZATION_SKILL_FILE_MAX_BYTES = 256_000;
export const ORGANIZATION_SKILL_BUNDLE_MAX_BYTES = 2_000_000;
export const ORGANIZATION_SKILL_FILE_LIMIT = 128;
export const ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT = 64;
export const ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES = 16_000_000;
export const ORGANIZATION_SKILL_OPERATION_ID_MAX_CHARS = 256;
export const ORGANIZATION_SKILL_ERROR_CODES = [
  "organization_skill.bundle_too_large",
  "organization_skill.edit_forbidden",
  "organization_skill.file_limit_reached",
  "organization_skill.frontmatter_invalid",
  "organization_skill.github_response_invalid",
  "organization_skill.github_selection_required",
  "organization_skill.github_source_changed",
  "organization_skill.github_tree_too_large",
  "organization_skill.github_unavailable",
  "organization_skill.github_url_invalid",
  "organization_skill.human_actor_required",
  "organization_skill.invalid_bundle",
  "organization_skill.maintainer_not_member",
  "organization_skill.manage_forbidden",
  "organization_skill.name_exists",
  "organization_skill.not_found",
  "organization_skill.operation_conflict",
  "organization_skill.operation_in_progress",
  "organization_skill.organization_context_changed",
  "organization_skill.release_digest_mismatch",
  "organization_skill.release_invalid",
  "organization_skill.release_missing",
  "organization_skill.release_object_missing",
  "organization_skill.runtime_catalog_too_large",
  "organization_skill.runtime_release_limit",
  "organization_skill.skill_markdown_invalid",
  "organization_skill.skill_markdown_missing",
  "organization_skill.store_unavailable",
  "organization_skill.unsafe_bundle",
  "organization_skill.version_conflict",
] as const;

const identifierSchema = z.string().trim().min(1).max(256);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const skillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_SKILL_NAME_MAX_CHARS)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Skill names use lowercase letters, numbers, and single hyphens."
  );
const descriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_SKILL_DESCRIPTION_MAX_CHARS);
const instructionsSchema = z
  .string()
  .max(ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS);
const sourceUrlSchema = z.url().max(2048);
const operationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_SKILL_OPERATION_ID_MAX_CHARS);
const metadataSchema = z.record(
  z.string().trim().min(1).max(128),
  z.string().max(1024)
);

export const organizationSkillGitHubSourceSchema = z.strictObject({
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  kind: z.literal("github"),
  path: z.string().max(1024),
  repository: sourceUrlSchema,
});

export const organizationSkillSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("created"),
  }),
  organizationSkillGitHubSourceSchema,
]);

export const organizationSkillPortableMetadataSchema = z.strictObject({
  allowedTools: z.string().max(2048).nullable(),
  compatibility: z.string().max(500).nullable(),
  description: descriptionSchema,
  license: z.string().max(1024).nullable(),
  metadata: metadataSchema,
  name: skillNameSchema,
});

export const organizationSkillFileSchema = z.strictObject({
  content: z.string().max(ORGANIZATION_SKILL_FILE_MAX_BYTES),
  encoding: z.enum(["base64", "utf8"]),
  mediaType: z.string().trim().min(1).max(256),
  path: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine(isSafePortableSkillPath, "Skill file path is not safe."),
  size: z.number().int().nonnegative().max(ORGANIZATION_SKILL_FILE_MAX_BYTES),
});

export const organizationSkillBundleSchema = z
  .strictObject({
    files: z
      .array(organizationSkillFileSchema)
      .max(ORGANIZATION_SKILL_FILE_LIMIT),
    instructions: instructionsSchema,
    portable: organizationSkillPortableMetadataSchema,
  })
  .superRefine((bundle, context) => {
    const normalizedPaths = new Set<string>();
    let totalSize = new TextEncoder().encode(bundle.instructions).byteLength;
    for (const [index, file] of bundle.files.entries()) {
      const normalized = file.path.normalize("NFC");
      if (normalizedPaths.has(normalized)) {
        context.addIssue({
          code: "custom",
          message: "Skill file paths must be unique after normalization.",
          path: ["files", index, "path"],
        });
      }
      if (normalized === "SKILL.md") {
        context.addIssue({
          code: "custom",
          message: "SKILL.md is represented by the portable Skill fields.",
          path: ["files", index, "path"],
        });
      }
      normalizedPaths.add(normalized);
      const actualSize = readOrganizationSkillFileSize(file);
      if (actualSize === null) {
        context.addIssue({
          code: "custom",
          message: "Skill file content is not valid base64.",
          path: ["files", index, "content"],
        });
        continue;
      }
      if (actualSize !== file.size) {
        context.addIssue({
          code: "custom",
          message: "Skill file size does not match its content.",
          path: ["files", index, "size"],
        });
      }
      if (actualSize > ORGANIZATION_SKILL_FILE_MAX_BYTES) {
        context.addIssue({
          code: "custom",
          message: "Skill file is too large.",
          path: ["files", index],
        });
      }
      totalSize += actualSize;
    }
    if (totalSize > ORGANIZATION_SKILL_BUNDLE_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Skill bundle is too large.",
        path: ["files"],
      });
    }
  });

export const organizationSkillReleaseSummarySchema = z.strictObject({
  createdAt: isoDateTimeSchema,
  createdByUserId: identifierSchema,
  digest: digestSchema,
  id: identifierSchema,
  source: organizationSkillSourceSchema,
});

export const organizationSkillPermissionsSchema = z.strictObject({
  canEdit: z.boolean(),
  canManage: z.boolean(),
});

export const organizationSkillSummarySchema = z.strictObject({
  activeRelease: organizationSkillReleaseSummarySchema,
  createdAt: isoDateTimeSchema,
  description: descriptionSchema,
  enabled: z.boolean(),
  id: identifierSchema,
  name: skillNameSchema,
  organizationId: identifierSchema,
  permissions: organizationSkillPermissionsSchema,
  source: organizationSkillSourceSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});

export const organizationSkillSchema = organizationSkillSummarySchema.extend({
  bundle: organizationSkillBundleSchema,
  maintainerUserIds: z.array(identifierSchema),
  releases: z.array(organizationSkillReleaseSummarySchema),
});

export const listOrganizationSkillsQuerySchema = z.strictObject({});
export const listOrganizationSkillsResponseSchema = z.strictObject({
  canManage: z.boolean(),
  organizationId: identifierSchema,
  skills: z.array(organizationSkillSummarySchema),
});

export const organizationSkillRouteParamsSchema = z.strictObject({
  skillId: identifierSchema,
});

export const getOrganizationSkillResponseSchema = z.strictObject({
  skill: organizationSkillSchema,
});

export const createOrganizationSkillBodySchema = z.strictObject({
  description: descriptionSchema,
  expectedOrganizationId: identifierSchema,
  instructions: instructionsSchema,
  name: skillNameSchema,
});
export const createOrganizationSkillResponseSchema = z.strictObject({
  skill: organizationSkillSchema,
});

export const updateOrganizationSkillBodySchema = z.strictObject({
  bundle: organizationSkillBundleSchema,
  expectedActiveReleaseId: identifierSchema,
  expectedOrganizationId: identifierSchema,
  expectedVersion: z.number().int().positive(),
});
export const updateOrganizationSkillResponseSchema = z.strictObject({
  skill: organizationSkillSchema,
});

export const setOrganizationSkillEnabledBodySchema = z.strictObject({
  enabled: z.boolean(),
  expectedOrganizationId: identifierSchema,
  expectedVersion: z.number().int().positive(),
});
export const setOrganizationSkillEnabledResponseSchema = z.strictObject({
  skill: organizationSkillSchema,
});

export const setOrganizationSkillMaintainersBodySchema = z.strictObject({
  expectedOrganizationId: identifierSchema,
  expectedVersion: z.number().int().positive(),
  maintainerUserIds: z.array(identifierSchema).max(100),
});
export const setOrganizationSkillMaintainersResponseSchema = z.strictObject({
  skill: organizationSkillSchema,
});

export const deleteOrganizationSkillBodySchema = z.strictObject({
  expectedOrganizationId: identifierSchema,
  expectedVersion: z.number().int().positive(),
});
export const deleteOrganizationSkillResponseSchema = z.strictObject({
  deleted: z.literal(true),
  organizationId: identifierSchema,
  skillId: identifierSchema,
});

export const importOrganizationSkillFromGitHubBodySchema = z.strictObject({
  expectedCommitSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  expectedOrganizationId: identifierSchema,
  url: sourceUrlSchema,
});
export const importOrganizationSkillFromGitHubResponseSchema = z.strictObject({
  skill: organizationSkillSchema,
});

export const previewOrganizationSkillFromGitHubBodySchema = z.strictObject({
  expectedOrganizationId: identifierSchema,
  url: sourceUrlSchema,
});
export const organizationSkillGitHubPreviewSchema = z.strictObject({
  files: z.array(
    organizationSkillFileSchema.pick({
      encoding: true,
      mediaType: true,
      path: true,
      size: true,
    })
  ),
  instructionsCharacters: z.number().int().nonnegative(),
  portable: organizationSkillPortableMetadataSchema,
  source: organizationSkillGitHubSourceSchema,
  warnings: z.array(z.string().trim().min(1).max(1024)),
});
export const previewOrganizationSkillFromGitHubResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  preview: organizationSkillGitHubPreviewSchema,
});

const centerAgentListOrganizationSkillsRpcInputSchema = z.strictObject({
  action: z.literal("list"),
  context: openMeldRequestContextSchema,
  speakerMember: centerAgentToolSpeakerSchema,
});
const centerAgentGetOrganizationSkillRpcInputSchema = z.strictObject({
  action: z.literal("get"),
  context: openMeldRequestContextSchema,
  skillId: identifierSchema,
  speakerMember: centerAgentToolSpeakerSchema,
});
const centerAgentPreviewOrganizationSkillFromGitHubRpcInputSchema =
  z.strictObject({
    action: z.literal("preview_github"),
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentToolSpeakerSchema,
    url: sourceUrlSchema,
  });
export const centerAgentReadOrganizationSkillsRpcInputSchema =
  z.discriminatedUnion("action", [
    centerAgentListOrganizationSkillsRpcInputSchema,
    centerAgentGetOrganizationSkillRpcInputSchema,
    centerAgentPreviewOrganizationSkillFromGitHubRpcInputSchema,
  ]);
export const centerAgentReadOrganizationSkillsResponseSchema =
  z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("list"),
      canManage: z.boolean(),
      organizationId: identifierSchema,
      skills: z.array(organizationSkillSummarySchema),
    }),
    z.strictObject({
      action: z.literal("get"),
      organizationId: identifierSchema,
      skill: organizationSkillSchema,
    }),
    z.strictObject({
      action: z.literal("preview_github"),
      organizationId: identifierSchema,
      preview: organizationSkillGitHubPreviewSchema,
    }),
  ]);

const centerAgentCreateOrganizationSkillRpcInputSchema = z.strictObject({
  action: z.literal("create"),
  bundle: organizationSkillBundleSchema,
  context: openMeldRequestContextSchema,
  operationId: operationIdSchema,
  speakerMember: centerAgentToolSpeakerSchema,
});
const centerAgentImportOrganizationSkillFromGitHubRpcInputSchema =
  z.strictObject({
    action: z.literal("import_github"),
    context: openMeldRequestContextSchema,
    expectedCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
    operationId: operationIdSchema,
    speakerMember: centerAgentToolSpeakerSchema,
    url: sourceUrlSchema,
  });
export const centerAgentInstallOrganizationSkillRpcInputSchema =
  z.discriminatedUnion("action", [
    centerAgentCreateOrganizationSkillRpcInputSchema,
    centerAgentImportOrganizationSkillFromGitHubRpcInputSchema,
  ]);
export const centerAgentInstallOrganizationSkillResponseSchema =
  z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("create"),
      organizationId: identifierSchema,
      skill: organizationSkillSummarySchema,
    }),
    z.strictObject({
      action: z.literal("import_github"),
      organizationId: identifierSchema,
      skill: organizationSkillSummarySchema,
    }),
  ]);

export const organizationSkillRuntimeReleaseSchema = z.strictObject({
  bundle: organizationSkillBundleSchema,
  digest: digestSchema,
  releaseId: identifierSchema,
  skillId: identifierSchema,
});
export const organizationSkillRuntimeReleaseSelectionSchema = z.strictObject({
  digest: digestSchema,
  name: skillNameSchema,
  releaseId: identifierSchema,
  skillId: identifierSchema,
});
export const organizationSkillRuntimeSnapshotResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  releases: z
    .array(organizationSkillRuntimeReleaseSchema)
    .max(ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT),
});

export const listOrganizationSkillsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const getOrganizationSkillRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  skillId: identifierSchema,
});
export const createOrganizationSkillRpcInputSchema =
  createOrganizationSkillBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const updateOrganizationSkillRpcInputSchema =
  updateOrganizationSkillBodySchema.extend({
    context: openMeldRequestContextSchema,
    skillId: identifierSchema,
  });
export const setOrganizationSkillEnabledRpcInputSchema =
  setOrganizationSkillEnabledBodySchema.extend({
    context: openMeldRequestContextSchema,
    skillId: identifierSchema,
  });
export const setOrganizationSkillMaintainersRpcInputSchema =
  setOrganizationSkillMaintainersBodySchema.extend({
    context: openMeldRequestContextSchema,
    skillId: identifierSchema,
  });
export const deleteOrganizationSkillRpcInputSchema =
  deleteOrganizationSkillBodySchema.extend({
    context: openMeldRequestContextSchema,
    skillId: identifierSchema,
  });
export const importOrganizationSkillFromGitHubRpcInputSchema =
  importOrganizationSkillFromGitHubBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const previewOrganizationSkillFromGitHubRpcInputSchema =
  previewOrganizationSkillFromGitHubBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const readOrganizationSkillRuntimeSnapshotRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema,
    releases: z
      .array(organizationSkillRuntimeReleaseSelectionSchema)
      .max(ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT),
  });

export const recordOrganizationSkillActivationRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  digest: digestSchema,
  releaseId: identifierSchema,
  routineRunId: identifierSchema.nullable(),
  skillId: identifierSchema,
  submissionId: identifierSchema,
});
export const recordOrganizationSkillActivationResponseSchema = z.strictObject({
  recorded: z.boolean(),
});

function isSafePortableSkillPath(value: string): boolean {
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}

function readOrganizationSkillFileSize(
  file: z.infer<typeof organizationSkillFileSchema>
): number | null {
  if (file.encoding === "utf8") {
    return new TextEncoder().encode(file.content).byteLength;
  }
  try {
    return atob(file.content).length;
  } catch {
    return null;
  }
}

export function stringifyOrganizationSkillBundleCanonicalJson(
  bundle: z.infer<typeof organizationSkillBundleSchema>
): string {
  return JSON.stringify(sortOrganizationSkillJson(bundle));
}

function sortOrganizationSkillJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortOrganizationSkillJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) =>
          compareOrganizationSkillJsonKeys(left, right)
        )
        .map(([key, item]) => [key, sortOrganizationSkillJson(item)])
    );
  }
  return value;
}

function compareOrganizationSkillJsonKeys(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

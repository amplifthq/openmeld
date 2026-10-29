import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentMemberResearchReportSchema } from "./center-agent-member-research";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";
import { organizationProtectedInformationSchema } from "./organization-information-protection";

export const ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS = 20_000;
export const ORGANIZATION_DOCUMENT_TITLE_MAX_CHARS = 200;
export const ORGANIZATION_DOCUMENT_FOLDER_NAME_MAX_CHARS = 200;
export const ORGANIZATION_DOCUMENT_OPERATION_ID_MAX_CHARS = 256;
export const ORGANIZATION_KNOWLEDGE_DOCUMENT_LIMIT = 50;
export const ORGANIZATION_DOCUMENT_FOLDER_LIMIT = 50;
export const CENTER_AGENT_PROFILE_REPORT_COMPUTER_ROOT =
  "/computer/home/documents/Profile Reports";
const CENTER_AGENT_PROFILE_REPORT_FORBIDDEN_PATH_CHARACTERS = '\\\\/:*?"<>|';
const CENTER_AGENT_PROFILE_REPORT_COLLISION_SUFFIX_PATTERN = / \(\d+\)$/u;
export const CENTER_AGENT_ORGANIZATION_DOCUMENT_DRAFT_CREATED_BY =
  "center_agent" as const;
export const ORGANIZATION_DOCUMENT_ERROR_CODES = [
  "organization_document.brief_exists",
  "organization_document.content_too_long",
  "organization_document.draft_changed",
  "organization_document.draft_not_found",
  "organization_document.folder_exists",
  "organization_document.folder_cycle",
  "organization_document.folder_limit_reached",
  "organization_document.folder_name_invalid",
  "organization_document.folder_not_found",
  "organization_document.human_actor_required",
  "organization_document.knowledge_limit_reached",
  "organization_document.managed_placement",
  "organization_document.member_profile_exists",
  "organization_document.not_found",
  "organization_document.operation_conflict",
  "organization_document.organization_context_changed",
  "organization_document.pending_draft_conflict",
  "organization_document.store_unavailable",
  "organization_document.subject_invalid",
  "organization_document.subject_not_member",
  "organization_document.title_invalid",
  "organization_document.write_forbidden",
  "organization_document.working_copy_conflict",
] as const;

export const organizationDocumentKindSchema = z.enum([
  "brief",
  "member_profile",
  "knowledge",
]);
export const profileReportTypeSchema = z.enum(["work_profile"]);

const identifierSchema = z.string().trim().min(1).max(256);
const titleSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_DOCUMENT_TITLE_MAX_CHARS);
const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_DOCUMENT_FOLDER_NAME_MAX_CHARS);

export function buildCenterAgentProfileReportComputerPath(input: {
  documentTitle: string;
  profileReportFolderName: string;
}): string {
  const folderName = sanitizeCenterAgentProfileReportPathSegment(
    input.profileReportFolderName
  );
  const documentTitle = sanitizeCenterAgentProfileReportPathSegment(
    input.documentTitle
  );
  return `${CENTER_AGENT_PROFILE_REPORT_COMPUTER_ROOT}/${folderName}/${documentTitle}.md`;
}

function sanitizeCenterAgentProfileReportPathSegment(value: string): string {
  const safeCharacters = Array.from(value.normalize("NFKC"), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 ||
      CENTER_AGENT_PROFILE_REPORT_FORBIDDEN_PATH_CHARACTERS.includes(character)
      ? " - "
      : character;
  }).join("");
  const sanitized = safeCharacters
    .replace(/\s+/gu, " ")
    .replace(/(?:\s+-\s+){2,}/gu, " - ")
    .replace(/^[.\s]+|[.\s]+$/gu, "")
    .trim();
  if (!sanitized) {
    throw new Error("Profile Report files require a folder name and title.");
  }
  const maxLength = 120;
  if (sanitized.length <= maxLength) {
    return sanitized;
  }
  const collisionSuffix = sanitized.match(
    CENTER_AGENT_PROFILE_REPORT_COLLISION_SUFFIX_PATTERN
  )?.[0];
  if (collisionSuffix && collisionSuffix.length < maxLength) {
    return `${sanitized.slice(0, maxLength - collisionSuffix.length).trimEnd()}${collisionSuffix}`;
  }
  return sanitized.slice(0, maxLength).trim();
}
const contentSchema = z.string().max(ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const operationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_DOCUMENT_OPERATION_ID_MAX_CHARS);

export const organizationDocumentFolderSchema = z.strictObject({
  createdAt: isoDateTimeSchema,
  id: identifierSchema,
  isManaged: z.boolean().default(false),
  name: folderNameSchema,
  organizationId: identifierSchema,
  parentFolderId: identifierSchema.nullable().optional(),
  updatedAt: isoDateTimeSchema,
});

export const organizationDocumentSummarySchema = z.strictObject({
  canEditContent: z.boolean(),
  canManage: z.boolean(),
  createdAt: isoDateTimeSchema,
  folderId: identifierSchema.nullable(),
  hasDraft: z.boolean(),
  id: identifierSchema,
  kind: organizationDocumentKindSchema,
  organizationId: identifierSchema,
  profileReportDate: z.iso.date().nullable().optional(),
  profileReportType: profileReportTypeSchema.nullable().optional(),
  subjectUserId: identifierSchema.nullable(),
  title: titleSchema,
  updatedAt: isoDateTimeSchema,
});

export const organizationDocumentSchema = organizationDocumentSummarySchema
  .omit({ hasDraft: true })
  .extend({
    content: contentSchema,
    draftContent: contentSchema.nullable(),
    draftCreatedAt: isoDateTimeSchema.nullable(),
    draftCreatedBy: z
      .literal(CENTER_AGENT_ORGANIZATION_DOCUMENT_DRAFT_CREATED_BY)
      .nullable(),
  });

export const listOrganizationDocumentsQuerySchema = z.strictObject({});
export const listOrganizationDocumentsResponseSchema = z.strictObject({
  canManage: z.boolean(),
  currentUserId: identifierSchema,
  documents: z.array(organizationDocumentSummarySchema),
  folders: z.array(organizationDocumentFolderSchema),
  organizationId: identifierSchema,
});

export const organizationDocumentRouteParamsSchema = z.strictObject({
  documentId: identifierSchema,
});

export const getOrganizationDocumentResponseSchema = z.strictObject({
  document: organizationDocumentSchema,
});

export const createOrganizationDocumentBodySchema = z
  .strictObject({
    content: contentSchema,
    expectedOrganizationId: identifierSchema,
    folderId: identifierSchema.nullable().optional(),
    kind: organizationDocumentKindSchema,
    subjectUserId: identifierSchema.nullable().optional(),
    title: titleSchema.optional(),
  })
  .superRefine(validateCreateDocumentShape);

export const createOrganizationDocumentResponseSchema = z.strictObject({
  document: organizationDocumentSchema,
});

export const updateOrganizationDocumentBodySchema = z
  .strictObject({
    content: contentSchema.optional(),
    expectedDocumentUpdatedAt: isoDateTimeSchema.optional(),
    expectedDraftCreatedAt: isoDateTimeSchema.nullable().optional(),
    expectedOrganizationId: identifierSchema,
    folderId: identifierSchema.nullable().optional(),
    title: titleSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.content === undefined) {
      return;
    }
    if (value.expectedDocumentUpdatedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "Saving content requires the loaded document version.",
        path: ["expectedDocumentUpdatedAt"],
      });
    }
    if (value.expectedDraftCreatedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "Saving content requires the loaded draft version.",
        path: ["expectedDraftCreatedAt"],
      });
    }
  })
  .refine(
    (value) =>
      value.content !== undefined ||
      value.title !== undefined ||
      value.folderId !== undefined,
    {
      message: "At least one document field must be updated.",
    }
  );

export const updateOrganizationDocumentResponseSchema = z.strictObject({
  document: organizationDocumentSchema,
});

export const deleteOrganizationDocumentBodySchema = z.strictObject({
  expectedOrganizationId: identifierSchema,
});
export const deleteOrganizationDocumentResponseSchema = z.strictObject({
  deleted: z.literal(true),
  documentId: identifierSchema,
  organizationId: identifierSchema,
});

export const organizationDocumentFolderRouteParamsSchema = z.strictObject({
  folderId: identifierSchema,
});

export const createOrganizationDocumentFolderBodySchema = z.strictObject({
  expectedOrganizationId: identifierSchema,
  name: folderNameSchema,
  parentFolderId: identifierSchema.nullable().optional(),
});
export const createOrganizationDocumentFolderResponseSchema = z.strictObject({
  folder: organizationDocumentFolderSchema,
});

export const updateOrganizationDocumentFolderBodySchema = z
  .strictObject({
    expectedOrganizationId: identifierSchema,
    name: folderNameSchema.optional(),
    parentFolderId: identifierSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      Number(value.name !== undefined) +
        Number(value.parentFolderId !== undefined) ===
      1,
    { message: "Exactly one folder field must be updated." }
  );
export const updateOrganizationDocumentFolderResponseSchema = z.strictObject({
  folder: organizationDocumentFolderSchema,
});

export const deleteOrganizationDocumentFolderBodySchema = z.strictObject({
  expectedOrganizationId: identifierSchema,
});
export const deleteOrganizationDocumentFolderResponseSchema = z.strictObject({
  deleted: z.literal(true),
  folderId: identifierSchema,
  organizationId: identifierSchema,
});

export const approveOrganizationDocumentDraftBodySchema = z.strictObject({
  expectedDraftCreatedAt: isoDateTimeSchema,
  expectedOrganizationId: identifierSchema,
});
export const approveOrganizationDocumentDraftResponseSchema = z.strictObject({
  document: organizationDocumentSchema,
});

export const discardOrganizationDocumentDraftBodySchema = z.strictObject({
  expectedDraftCreatedAt: isoDateTimeSchema,
  expectedOrganizationId: identifierSchema,
});
export const discardOrganizationDocumentDraftResponseSchema = z.strictObject({
  document: organizationDocumentSchema,
});

export const listOrganizationDocumentsRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const getOrganizationDocumentRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  documentId: identifierSchema,
});
export const createOrganizationDocumentRpcInputSchema =
  createOrganizationDocumentBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const updateOrganizationDocumentRpcInputSchema =
  updateOrganizationDocumentBodySchema.extend({
    context: openMeldRequestContextSchema,
    documentId: identifierSchema,
  });
export const deleteOrganizationDocumentRpcInputSchema =
  deleteOrganizationDocumentBodySchema.extend({
    context: openMeldRequestContextSchema,
    documentId: identifierSchema,
  });
export const createOrganizationDocumentFolderRpcInputSchema =
  createOrganizationDocumentFolderBodySchema.extend({
    context: openMeldRequestContextSchema,
  });
export const updateOrganizationDocumentFolderRpcInputSchema =
  updateOrganizationDocumentFolderBodySchema.extend({
    context: openMeldRequestContextSchema,
    folderId: identifierSchema,
  });
export const deleteOrganizationDocumentFolderRpcInputSchema =
  deleteOrganizationDocumentFolderBodySchema.extend({
    context: openMeldRequestContextSchema,
    folderId: identifierSchema,
  });
export const approveOrganizationDocumentDraftRpcInputSchema =
  approveOrganizationDocumentDraftBodySchema.extend({
    context: openMeldRequestContextSchema,
    documentId: identifierSchema,
  });
export const discardOrganizationDocumentDraftRpcInputSchema =
  discardOrganizationDocumentDraftBodySchema.extend({
    context: openMeldRequestContextSchema,
    documentId: identifierSchema,
  });

// Personal Remote reads use their admitted receiving identity. Center callers
// still require a verified speaker; Core enforces this distinction.
const centerAgentReadOrganizationDocumentsListInputSchema = z.strictObject({
  action: z.literal("list"),
  context: openMeldRequestContextSchema,
  speakerMember: centerAgentToolSpeakerSchema.optional(),
});
const centerAgentReadOrganizationDocumentInputSchema = z.strictObject({
  action: z.literal("get"),
  context: openMeldRequestContextSchema,
  documentId: identifierSchema,
  speakerMember: centerAgentToolSpeakerSchema.optional(),
});
export const centerAgentReadOrganizationDocumentsRpcInputSchema =
  z.discriminatedUnion("action", [
    centerAgentReadOrganizationDocumentsListInputSchema,
    centerAgentReadOrganizationDocumentInputSchema,
  ]);
export const centerAgentReadOrganizationDocumentsResponseSchema =
  z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("list"),
      documents: z.array(
        organizationDocumentSummarySchema.pick({
          folderId: true,
          id: true,
          kind: true,
          title: true,
          updatedAt: true,
        })
      ),
      folders: z.array(organizationDocumentFolderSchema),
      organizationId: identifierSchema,
    }),
    z.strictObject({
      action: z.literal("get"),
      document: organizationDocumentSchema.pick({
        content: true,
        folderId: true,
        id: true,
        kind: true,
        subjectUserId: true,
        title: true,
        updatedAt: true,
      }),
      organizationId: identifierSchema,
    }),
  ]);

const organizationDocumentComputerProjectionSchema =
  organizationDocumentSchema.pick({
    content: true,
    folderId: true,
    id: true,
    kind: true,
    subjectUserId: true,
    title: true,
    updatedAt: true,
  });

export const centerAgentOrganizationDocumentsComputerSnapshotRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema,
  });

export const centerAgentOrganizationDocumentsComputerSnapshotResponseSchema =
  z.strictObject({
    documents: z.array(organizationDocumentComputerProjectionSchema),
    folders: z.array(organizationDocumentFolderSchema),
    organizationId: identifierSchema,
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
  });

export const centerAgentDraftOrganizationDocumentRpcInputSchema = z
  .strictObject({
    context: openMeldRequestContextSchema,
    documentId: identifierSchema.optional(),
    draftContent: contentSchema,
    expectedDocumentUpdatedAt: isoDateTimeSchema.optional(),
    folderId: identifierSchema.nullable().optional(),
    kind: organizationDocumentKindSchema.optional(),
    memberResearchReport: centerAgentMemberResearchReportSchema.optional(),
    memberResearchTaskId: identifierSchema.optional(),
    speakerMember: centerAgentToolSpeakerSchema,
    subjectUserId: identifierSchema.optional(),
    title: titleSchema.optional(),
  })
  .superRefine(validateCenterAgentDraftTarget);
export const centerAgentDraftOrganizationDocumentResponseSchema =
  z.strictObject({
    document: organizationDocumentSummarySchema,
    draftReplaced: z.boolean(),
    memberResearchDraft: z
      .strictObject({
        content: contentSchema,
        documentId: identifierSchema,
        profileReportFolderName: folderNameSchema,
        subjectUserId: identifierSchema,
        title: titleSchema,
      })
      .optional(),
  });

export const recordCenterAgentMemberResearchComputerFileRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema,
    documentId: identifierSchema,
    path: z.string().trim().min(1).max(1024),
    subjectUserId: identifierSchema,
    taskId: identifierSchema,
  });

export const recordCenterAgentMemberResearchComputerFileResponseSchema =
  z.strictObject({
    documentId: identifierSchema,
    path: z.string().trim().min(1).max(1024),
    recorded: z.literal(true),
    taskId: identifierSchema,
  });

const centerAgentOrganizationDocumentProjectionSchema =
  organizationDocumentSchema.pick({
    content: true,
    folderId: true,
    id: true,
    kind: true,
    title: true,
    updatedAt: true,
  });

const centerAgentCreateOrganizationDocumentFolderInputSchema = z.strictObject({
  action: z.literal("create_folder"),
  context: openMeldRequestContextSchema,
  name: folderNameSchema,
  operationId: operationIdSchema,
  parentFolderId: identifierSchema.nullable().optional(),
  speakerMember: centerAgentToolSpeakerSchema,
});
const centerAgentRenameOrganizationDocumentFolderInputSchema = z.strictObject({
  action: z.literal("rename_folder"),
  context: openMeldRequestContextSchema,
  folderId: identifierSchema,
  name: folderNameSchema,
  operationId: operationIdSchema,
  speakerMember: centerAgentToolSpeakerSchema,
});
const centerAgentMoveOrganizationDocumentInputSchema = z.strictObject({
  action: z.literal("move_document"),
  context: openMeldRequestContextSchema,
  documentId: identifierSchema,
  folderId: identifierSchema.nullable(),
  operationId: operationIdSchema,
  speakerMember: centerAgentToolSpeakerSchema,
});
const centerAgentSaveOrganizationDocumentInputSchema = z
  .strictObject({
    action: z.literal("save_document"),
    content: contentSchema,
    context: openMeldRequestContextSchema,
    documentId: identifierSchema.optional(),
    folderId: identifierSchema.nullable().optional(),
    operationId: operationIdSchema,
    speakerMember: centerAgentToolSpeakerSchema,
    title: titleSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!(value.documentId || value.title)) {
      context.addIssue({
        code: "custom",
        message: "A new knowledge document requires a title.",
        path: ["title"],
      });
    }
  });

export const centerAgentManageOrganizationDocumentsRpcInputSchema =
  z.discriminatedUnion("action", [
    centerAgentCreateOrganizationDocumentFolderInputSchema,
    centerAgentRenameOrganizationDocumentFolderInputSchema,
    centerAgentMoveOrganizationDocumentInputSchema,
    centerAgentSaveOrganizationDocumentInputSchema,
  ]);

export const centerAgentManageOrganizationDocumentsResponseSchema =
  z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("create_folder"),
      folder: organizationDocumentFolderSchema,
      organizationId: identifierSchema,
    }),
    z.strictObject({
      action: z.literal("rename_folder"),
      folder: organizationDocumentFolderSchema,
      organizationId: identifierSchema,
    }),
    z.strictObject({
      action: z.literal("move_document"),
      document: centerAgentOrganizationDocumentProjectionSchema,
      organizationId: identifierSchema,
    }),
    z.strictObject({
      action: z.literal("save_document"),
      document: centerAgentOrganizationDocumentProjectionSchema,
      organizationId: identifierSchema,
      outcome: z.enum(["created", "updated"]),
    }),
  ]);

export const organizationDocumentSourceReferenceSchema = z.strictObject({
  kind: z.literal("organization_document"),
  documentId: identifierSchema,
  state: z.literal("current"),
  version: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const organizationDocumentPromptContextRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  includeOrganizationProtectedInformation: z.literal(true).optional(),
  includeSourceReferences: z.literal(true).optional(),
});
export const organizationDocumentPromptContextResponseSchema = z.strictObject({
  briefContent: contentSchema.nullable(),
  documentTitles: z.array(titleSchema),
  organizationProtectedInformation: organizationProtectedInformationSchema
    .nullable()
    .optional(),
  organizationId: identifierSchema,
  briefSource: organizationDocumentSourceReferenceSchema.nullable().optional(),
});

function validateCreateDocumentShape(
  value: {
    kind: zod.infer<typeof organizationDocumentKindSchema>;
    subjectUserId?: string | null;
    title?: string;
  },
  context: zod.RefinementCtx
): void {
  if (value.kind === "member_profile" && !value.subjectUserId) {
    context.addIssue({
      code: "custom",
      message: "A Profile Report requires a subject user.",
      path: ["subjectUserId"],
    });
  }
  if (value.kind !== "member_profile" && value.subjectUserId != null) {
    context.addIssue({
      code: "custom",
      message: "Only a Profile Report can have a subject user.",
      path: ["subjectUserId"],
    });
  }
  if (value.kind === "knowledge" && !value.title) {
    context.addIssue({
      code: "custom",
      message: "A knowledge document requires a title.",
      path: ["title"],
    });
  }
}

function validateCenterAgentDraftTarget(
  value: {
    documentId?: string;
    expectedDocumentUpdatedAt?: string;
    folderId?: string | null;
    kind?: zod.infer<typeof organizationDocumentKindSchema>;
    memberResearchReport?: zod.infer<
      typeof centerAgentMemberResearchReportSchema
    >;
    memberResearchTaskId?: string;
    subjectUserId?: string;
    title?: string;
  },
  context: zod.RefinementCtx
): void {
  if (
    Boolean(value.memberResearchTaskId) !== Boolean(value.memberResearchReport)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Member research drafts require both memberResearchTaskId and memberResearchReport.",
      path: ["memberResearchReport"],
    });
  }
  if (value.documentId) {
    if (
      value.folderId !== undefined ||
      value.kind ||
      value.subjectUserId ||
      value.title
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A document id cannot be combined with a new document target or folder placement.",
      });
    }
    return;
  }
  if (!value.kind) {
    context.addIssue({
      code: "custom",
      message: "A new draft requires a document kind.",
      path: ["kind"],
    });
    return;
  }
  if (value.expectedDocumentUpdatedAt) {
    context.addIssue({
      code: "custom",
      message: "A working-copy version requires an existing document id.",
      path: ["expectedDocumentUpdatedAt"],
    });
  }
  validateCreateDocumentShape(
    {
      kind: value.kind,
      ...(value.subjectUserId ? { subjectUserId: value.subjectUserId } : {}),
      ...(value.title ? { title: value.title } : {}),
    },
    context
  );
}

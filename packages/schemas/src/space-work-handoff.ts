import * as z from "zod/v4";
import {
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  SPACE_MESSAGE_FILE_MAX_COUNT,
  spaceMessageFileReferenceSchema,
} from "./schemas/http/space-files";
import { executionContextProjectWorkSchema } from "./schemas/protocol/execution-context";

export const SPACE_WORK_HANDOFF_CAPABILITY_HEADER =
  "x-openmeld-space-work-handoff";

// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in filesystem paths.
const unsafeSegment = /[<>:"\\|?*\u0000-\u001f]|[. ]$/u;
const reservedSegment = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
export const spaceWorkRelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      path
        .split("/")
        .every(
          (part) =>
            part.length > 0 &&
            part !== "." &&
            part !== ".." &&
            part.toLowerCase() !== ".git" &&
            part.toLowerCase() !== ".openmeld-skills" &&
            !unsafeSegment.test(part) &&
            !reservedSegment.test(part)
        ),
    "Use a relative file path without reserved names, traversal, or unsafe characters."
  );

export const spaceWorkFileSelectionSchema = z.strictObject({
  fileId: z.string().min(1).max(128),
  revision: z.number().int().positive(),
  relativePath: spaceWorkRelativePathSchema,
});
const selectedFiles = z
  .array(spaceWorkFileSelectionSchema)
  .max(SPACE_MESSAGE_FILE_MAX_COUNT)
  .superRefine((files, context) => {
    const paths = new Set<string>();
    const ids = new Set<string>();
    for (const file of files) {
      const path = file.relativePath.normalize("NFC").toLowerCase();
      if (
        ids.has(file.fileId) ||
        [...paths].some(
          (other) =>
            other === path ||
            other.startsWith(`${path}/`) ||
            path.startsWith(`${other}/`)
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Select each file once with distinct, non-overlapping paths.",
        });
      }
      ids.add(file.fileId);
      paths.add(path);
    }
  });
export const spaceWorkSelectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  files: selectedFiles.min(1),
});
export const SPACE_WORK_MAX_BYTES =
  SPACE_MESSAGE_FILE_MAX_COUNT * SPACE_FILE_RAW_UPLOAD_MAX_BYTES;
export type SpaceWorkSelection = z.infer<typeof spaceWorkSelectionSchema>;

const selectedFileWorkHandoffSchema = spaceWorkSelectionSchema.safeExtend({
  skills: z
    .array(
      z.strictObject({
        skillId: z.string().min(1).max(128),
        releaseId: z.string().min(1).max(128),
        digest: z.string().regex(/^[a-f0-9]{64}$/u),
        name: z.string().min(1).max(128),
      })
    )
    .max(10)
    .refine(
      (skills) =>
        new Set(skills.map((skill) => skill.skillId)).size === skills.length,
      "Select each Skill once."
    ),
  work: z.strictObject({
    goal: z.string().min(1).max(4000),
    completed: z.string().max(4000),
    nextSteps: z.string().min(1).max(4000),
  }),
  requirements: z.array(z.string().min(1).max(500)).max(10),
});
// Published code uses the same message, dispatch, file, and result owners as a
// selected-file handoff. Version 2 requires a receiver that pins the commit.
const briefItems = z.array(z.string().trim().min(1).max(2000)).max(20);
export const spaceCodeWorkHandoffSchema = selectedFileWorkHandoffSchema.extend({
  schemaVersion: z.literal(2),
  files: selectedFiles,
  sourceSignalId: z.string().trim().min(1).max(2048),
  sourceRevision: z.number().int().positive(),
  code: executionContextProjectWorkSchema.required({ commit: true }),
  execution: z.strictObject({
    workspace: z.enum(["current", "isolated"]),
    access: z.enum(["read_only", "workspace"]).optional(),
  }),
  work: selectedFileWorkHandoffSchema.shape.work.extend({
    evidence: briefItems,
    attemptedApproaches: briefItems,
    decisions: briefItems,
    constraints: briefItems,
    openQuestions: briefItems,
    completionCriteria: briefItems.min(1),
  }),
});
export const spaceWorkHandoffSchema = z.union([
  selectedFileWorkHandoffSchema,
  spaceCodeWorkHandoffSchema,
]);
export type SpaceCodeWorkHandoff = z.infer<typeof spaceCodeWorkHandoffSchema>;
export type SpaceWorkHandoff = z.infer<typeof spaceWorkHandoffSchema>;

/** Service-only projection after preparing the dispatch's selected inputs. */
export const spaceWorkingCopyAccessSchema = z.object({
  workingCopyId: z.string().uuid().optional(),
});
export type SpaceWorkingCopyAccess = z.infer<
  typeof spaceWorkingCopyAccessSchema
>;

export const spaceWorkingCopyResultSchema = z.union([
  z.strictObject({
    copyId: z.string().uuid(),
    root: z.string(),
    ready: z.literal(true),
  }),
  z.strictObject({ copyId: z.string().uuid(), reconciled: z.literal(true) }),
  z.strictObject({ copyId: z.string().uuid(), refreshed: z.literal(true) }),
  z.strictObject({ copyId: z.string().uuid(), resolved: z.literal(true) }),
  z.strictObject({
    copyId: z.string().uuid(),
    references: z
      .array(spaceMessageFileReferenceSchema)
      .max(SPACE_MESSAGE_FILE_MAX_COUNT),
    files: z
      .array(spaceWorkFileSelectionSchema)
      .max(SPACE_MESSAGE_FILE_MAX_COUNT),
  }),
  z.strictObject({
    copyId: z.string().uuid(),
    root: z.string(),
    files: z
      .array(
        spaceWorkFileSelectionSchema.extend({
          incomingRevision: z.number().int().positive().optional(),
          incomingPath: spaceWorkRelativePathSchema.optional(),
          status: z.enum([
            "conflict",
            "pending",
            "preparing",
            "missing",
            "clean",
            "changed",
          ]),
        })
      )
      .max(SPACE_MESSAGE_FILE_MAX_COUNT),
  }),
]);

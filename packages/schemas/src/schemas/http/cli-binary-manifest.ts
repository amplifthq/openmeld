import { z } from "zod/v4";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }
  let contentEnd = value.length;
  if (value.endsWith("==")) {
    contentEnd -= 2;
  } else if (value.endsWith("=")) {
    contentEnd -= 1;
  }
  for (let index = 0; index < contentEnd; index += 1) {
    const code = value.charCodeAt(index);
    const isBase64Code =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!isBase64Code) {
      return false;
    }
  }
  return true;
}

const cliBinaryArtifactSchema = z.object({
  sha256: z.string().regex(SHA256_HEX_PATTERN),
  sizeBytes: z.number().int().positive(),
  url: z.url(),
});

const cliBinaryArchiveTransportSchema = z.object({
  archiveFormat: z.literal("gzip"),
  archiveSha256: z.string().regex(SHA256_HEX_PATTERN),
  archiveSizeBytes: z.number().int().positive(),
  archiveUrl: z.url(),
});

export const cliBinaryCompressedReleaseSchema = cliBinaryArtifactSchema.extend(
  cliBinaryArchiveTransportSchema.shape
);

export const cliBinaryDeltaPatchSchema = z.object({
  baseSha256: z.string().regex(SHA256_HEX_PATTERN),
  baseSizeBytes: z.number().int().positive(),
  blockSizeBytes: z.literal(4096),
  patchFormat: z.literal("block-ranges-v1"),
  schemaVersion: z.literal(1),
  segments: z
    .array(
      z.object({
        dataBase64: z.string().min(4).refine(isBase64, "invalid base64"),
        offset: z.number().int().nonnegative(),
      })
    )
    .max(100_000),
  targetSha256: z.string().regex(SHA256_HEX_PATTERN),
  targetSizeBytes: z.number().int().positive(),
});

export const cliBinaryDeltaTransportSchema = z.object({
  fromSha256: z.string().regex(SHA256_HEX_PATTERN),
  fromSizeBytes: z.number().int().positive(),
  fromVersion: z.string().trim().min(1),
  patchCompression: z.literal("gzip"),
  patchFormat: z.literal("block-ranges-v1"),
  patchPayloadSizeBytes: z.number().int().positive(),
  patchSha256: z.string().regex(SHA256_HEX_PATTERN),
  patchSizeBytes: z.number().int().positive(),
  patchUrl: z.url(),
});

export const cliBinaryReleaseSchema = cliBinaryArtifactSchema
  .extend({
    archiveFormat:
      cliBinaryArchiveTransportSchema.shape.archiveFormat.optional(),
    archiveSha256:
      cliBinaryArchiveTransportSchema.shape.archiveSha256.optional(),
    archiveSizeBytes:
      cliBinaryArchiveTransportSchema.shape.archiveSizeBytes.optional(),
    archiveUrl: cliBinaryArchiveTransportSchema.shape.archiveUrl.optional(),
    codeIdentifier: z.string().trim().min(1).optional(),
    deltas: z.array(cliBinaryDeltaTransportSchema).max(8).optional(),
    teamIdentifier: z.string().trim().min(1).optional(),
  })
  .superRefine((release, context) => {
    const archiveFields = [
      release.archiveFormat,
      release.archiveSha256,
      release.archiveSizeBytes,
      release.archiveUrl,
    ];
    if (
      !(
        archiveFields.every((value) => value === undefined) ||
        archiveFields.every((value) => value !== undefined)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "compressed transport fields must be provided together",
      });
    }

    if (
      (release.codeIdentifier === undefined) !==
      (release.teamIdentifier === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "signature identity fields must be provided together",
      });
    }

    const deltaBases = new Set<string>();
    for (const delta of release.deltas ?? []) {
      const baseKey = `${delta.fromVersion}:${delta.fromSha256}`;
      if (deltaBases.has(baseKey)) {
        context.addIssue({
          code: "custom",
          message: "delta base records must be unique",
        });
        break;
      }
      deltaBases.add(baseKey);
    }
  });

export const cliBinaryManifestSchema = z.object({
  channels: z.object({
    stable: z.object({
      minRequiredCliVersion: z.string().trim().min(1).nullable().optional(),
      platforms: z
        .record(z.string().trim().min(1), cliBinaryReleaseSchema)
        .refine((platforms) => Object.keys(platforms).length > 0, {
          message: "at least one platform is required",
        }),
      version: z.string().trim().min(1),
    }),
  }),
  schemaVersion: z.literal(1),
});

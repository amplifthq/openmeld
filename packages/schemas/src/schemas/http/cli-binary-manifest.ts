import * as z from "zod/v4";
import { windowsPublisherNameSchema } from "#windows-artifact";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

// Release manifests use product platform names, not Node's Windows OS token.
export function resolveCliBinaryPlatform(os: string, arch: string): string {
  return `${os === "win32" ? "windows" : os}-${arch}`;
}
// The macOS CLI publisher identity is a trusted client expectation, not a
// value that a downloaded manifest may choose for itself.
export const OPENMELD_MACOS_CLI_SIGNING_IDENTITY = {
  codeIdentifier: "sh.openmeld.cli",
  teamIdentifier: "38FFHDPA3B",
} as const;

// Require Apple's Developer ID Application chain, not just matching fields
// printed by codesign --display or a requirement chosen by the artifact.
export const OPENMELD_MACOS_CLI_SIGNING_REQUIREMENT = `anchor apple generic and identifier "${OPENMELD_MACOS_CLI_SIGNING_IDENTITY.codeIdentifier}" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${OPENMELD_MACOS_CLI_SIGNING_IDENTITY.teamIdentifier}"`;

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
    windows: z
      .union([
        z.strictObject({
          publisherName: windowsPublisherNameSchema,
          processHelper: cliBinaryArtifactSchema,
        }),
        z.strictObject({
          mode: z.literal("internal-unsigned-preview"),
          processHelper: cliBinaryArtifactSchema,
        }),
      ])
      .optional(),
  })
  .superRefine((release, context) => {
    if (release.windows && (release.codeIdentifier || release.teamIdentifier)) {
      context.addIssue({
        code: "custom",
        message: "Windows and macOS signature identities cannot be combined",
      });
    }
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

const binaryPlatformsSchema = z
  .record(z.string().trim().min(1), cliBinaryReleaseSchema)
  .refine((platforms) => Object.keys(platforms).length > 0, {
    message: "at least one platform is required",
  })
  .superRefine((platforms, context) => {
    for (const [platform, release] of Object.entries(platforms)) {
      if (platform.startsWith("windows-") !== Boolean(release.windows)) {
        context.addIssue({
          code: "custom",
          path: [platform, "windows"],
          message: "Windows artifact metadata must match its platform",
        });
      }
    }
  });

export const cliBinaryServiceReleaseSchema = z.object({
  platforms: binaryPlatformsSchema,
  version: z.string().trim().min(1),
});

export const cliBinaryManifestSchema = z.object({
  channels: z.object({
    stable: z
      .object({
        minRequiredCliVersion: z.string().trim().min(1).nullable().optional(),
        platforms: binaryPlatformsSchema,
        // Omitted by legacy channels whose CLI binary also supplies the Service.
        // A selected Service release has its own immutable artifact metadata;
        // a version number alone cannot safely select or verify an executable.
        service: cliBinaryServiceReleaseSchema.optional(),
        version: z.string().trim().min(1),
      })
      .superRefine((stable, context) => {
        if (!stable.service) {
          return;
        }
        for (const platform of Object.keys(stable.platforms)) {
          if (!stable.service.platforms[platform]) {
            context.addIssue({
              code: "custom",
              path: ["service", "platforms", platform],
              message: "a Service artifact is required for every CLI platform",
            });
          }
        }
      }),
  }),
  schemaVersion: z.literal(1),
});

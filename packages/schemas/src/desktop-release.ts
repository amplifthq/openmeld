import * as z from "zod/v4";
import { windowsPublisherNameSchema } from "#windows-artifact";

export const desktopCandidateIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const desktopVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  .max(100);
export const DESKTOP_UPDATE_FEED_URL = "https://openmeld.ai/desktop/updates";
export const desktopReleasePlatformSchema = z.enum([
  "macos-arm64",
  "windows-x64",
  "windows-arm64",
]);
export type DesktopReleasePlatform = z.infer<
  typeof desktopReleasePlatformSchema
>;
export const desktopDownloadQuerySchema = z.strictObject({
  candidate: desktopCandidateIdSchema.optional(),
  platform: desktopReleasePlatformSchema.optional(),
});
export const desktopDownloadReleaseSchema = z.strictObject({
  platform: desktopReleasePlatformSchema,
  version: desktopVersionSchema,
  sizeBytes: z.number().int().positive().nullable(),
  downloadPath: z
    .string()
    .regex(
      /^\/desktop\/download(?:\?(?:candidate=[a-f0-9]{64}|platform=windows-(?:x64|arm64)))?$/u
    ),
  message: z.string().nullable(),
});
export type DesktopDownloadRelease = z.infer<
  typeof desktopDownloadReleaseSchema
>;
export const desktopDownloadsSchema = z.strictObject({
  releases: z.array(desktopDownloadReleaseSchema).max(3),
});
export type DesktopDownloads = z.infer<typeof desktopDownloadsSchema>;
export const desktopWindowsBuildSchema = z.strictObject({
  platform: z.enum(["windows-x64", "windows-arm64"]),
  publisherName: windowsPublisherNameSchema,
});

export const DESKTOP_WINDOWS_INTERNAL_PREVIEW_KEY =
  "desktop/internal-preview-windows-x64.json";
export const desktopWindowsInternalPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  platform: z.literal("windows-x64"),
  version: desktopVersionSchema,
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  sha256: desktopCandidateIdSchema,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export function desktopWindowsInternalPreviewLocation(
  input: z.infer<typeof desktopWindowsInternalPreviewSchema>
) {
  const parsed = desktopWindowsInternalPreviewSchema.parse(input);
  const artifactName = `OpenMeld-Desktop-${parsed.version}-windows-x64-internal-preview.exe`;
  return {
    artifactName,
    objectKey: `desktop/internal-preview/${parsed.sha256}/${artifactName}`,
    downloadPath: "/desktop/download?platform=windows-x64",
  };
}

export function resolveDesktopReleasePlatform(
  platform: string,
  arch: string
): DesktopReleasePlatform | null {
  if (platform === "darwin" && arch === "arm64") {
    return "macos-arm64";
  }
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    return `windows-${arch}`;
  }
  return null;
}

export function desktopPlatformUpdateFeedUrl(
  platform: DesktopReleasePlatform
): string {
  desktopReleasePlatformSchema.parse(platform);
  return platform === "macos-arm64"
    ? DESKTOP_UPDATE_FEED_URL
    : `${DESKTOP_UPDATE_FEED_URL}/${platform}`;
}

const sha512Schema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/u);
export function desktopUpdaterFeedSchemaForPlatform(
  platform: DesktopReleasePlatform
) {
  desktopReleasePlatformSchema.parse(platform);
  const artifact =
    platform === "macos-arm64" ? "desktop\\.zip" : `${platform}\\.exe`;
  const updatePathSchema = z
    .string()
    .regex(new RegExp(`^/desktop/updates/[a-f0-9]{64}/${artifact}$`, "u"));
  return z
    .strictObject({
      version: desktopVersionSchema,
      releaseDate: z.iso.datetime(),
      files: z
        .array(
          z.strictObject({
            url: updatePathSchema,
            sha512: sha512Schema,
            size: z.number().int().positive(),
          })
        )
        .length(1),
      path: updatePathSchema,
      sha512: sha512Schema,
    })
    .refine((feed) => {
      const [file] = feed.files;
      return file?.url === feed.path && file.sha512 === feed.sha512;
    }, "Desktop update metadata must select one artifact.");
}
// Existing Mac clients retain the exact old feed shape and accepted path.
export const desktopUpdaterFeedSchema =
  desktopUpdaterFeedSchemaForPlatform("macos-arm64");

/** Immutable candidate metadata; it never selects the default update channel. */
export const desktopCandidateManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    target: z.literal("production"),
    platform: desktopReleasePlatformSchema,
    version: desktopVersionSchema,
    releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
    sha256: desktopCandidateIdSchema,
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    zip: z
      .strictObject({
        sha256: desktopCandidateIdSchema,
        sha512: sha512Schema,
        sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .optional(),
    windows: z
      .strictObject({
        sha512: sha512Schema,
        publisherName: desktopWindowsBuildSchema.shape.publisherName,
      })
      .optional(),
  })
  .refine(
    (manifest) =>
      manifest.platform === "macos-arm64"
        ? manifest.windows === undefined
        : manifest.windows !== undefined && manifest.zip === undefined,
    "Desktop candidates must contain only their platform's signed update artifact."
  );
export const DESKTOP_PROMOTED_RELEASE_KEY = "desktop/promoted.json";
export function desktopPromotedReleaseKey(
  platform: DesktopReleasePlatform
): string {
  desktopReleasePlatformSchema.parse(platform);
  return platform === "macos-arm64"
    ? DESKTOP_PROMOTED_RELEASE_KEY
    : `desktop/promoted-${platform}.json`;
}
export const desktopPromotedReleaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidate: desktopCandidateIdSchema,
  promotedAt: z.iso.datetime(),
});
export type DesktopCandidateManifest = z.infer<
  typeof desktopCandidateManifestSchema
>;

export function desktopCandidateLocation(input: DesktopCandidateManifest) {
  const manifest = desktopCandidateManifestSchema.parse(input);
  const mac = manifest.platform === "macos-arm64";
  const artifactName = `OpenMeld-Desktop-${manifest.version}-${manifest.platform}.${mac ? "dmg" : "exe"}`;
  return {
    artifactName,
    objectKey: `desktop/candidates/${manifest.sha256}/${artifactName}`,
    manifestKey: desktopCandidateManifestKey(manifest.sha256),
    downloadPath: `/desktop/download?candidate=${manifest.sha256}`,
    zipObjectKey: mac
      ? `desktop/candidates/${manifest.sha256}/OpenMeld-Desktop-${manifest.version}-macos-arm64.zip`
      : null,
    zipDownloadPath: mac
      ? `/desktop/updates/${manifest.sha256}/desktop.zip`
      : null,
  };
}

export function desktopCandidateManifestKey(candidate: string) {
  return `desktop/candidates/${desktopCandidateIdSchema.parse(candidate)}/manifest.json`;
}

/** One immutable update payload: a Mac ZIP or the Windows download installer. */
export function desktopCandidateUpdateArtifact(
  input: DesktopCandidateManifest
) {
  // Readers may attach derived paths to the already validated manifest. Select
  // canonical fields explicitly: persisted metadata stays strict, and caller
  // supplied objectKey/downloadPath can never redirect the update payload.
  const manifest = desktopCandidateManifestSchema.parse({
    schemaVersion: input.schemaVersion,
    target: input.target,
    platform: input.platform,
    version: input.version,
    releaseSha: input.releaseSha,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    ...(input.zip ? { zip: input.zip } : {}),
    ...(input.windows ? { windows: input.windows } : {}),
  });
  const location = desktopCandidateLocation(manifest);
  if (manifest.platform === "macos-arm64") {
    return manifest.zip && location.zipObjectKey && location.zipDownloadPath
      ? {
          objectKey: location.zipObjectKey,
          path: location.zipDownloadPath,
          ...manifest.zip,
        }
      : null;
  }
  return manifest.windows
    ? {
        objectKey: location.objectKey,
        path: `/desktop/updates/${manifest.sha256}/${manifest.platform}.exe`,
        sha256: manifest.sha256,
        sha512: manifest.windows.sha512,
        sizeBytes: manifest.sizeBytes,
      }
    : null;
}

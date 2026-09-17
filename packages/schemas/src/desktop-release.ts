import * as z from "zod/v4";

export const desktopCandidateIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const desktopVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  .max(100);
export const DESKTOP_UPDATE_FEED_URL = "https://openmeld.ai/desktop/updates";
const updateZipPathSchema = z
  .string()
  .regex(/^\/desktop\/updates\/[a-f0-9]{64}\/desktop\.zip$/u);
const sha512Schema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/u);
export const desktopUpdaterFeedSchema = z
  .strictObject({
    version: desktopVersionSchema,
    releaseDate: z.iso.datetime(),
    files: z
      .array(
        z.strictObject({
          url: updateZipPathSchema,
          sha512: sha512Schema,
          size: z.number().int().positive(),
        })
      )
      .length(1),
    path: updateZipPathSchema,
    sha512: sha512Schema,
  })
  .refine((feed) => {
    const [file] = feed.files;
    return file?.url === feed.path && file.sha512 === feed.sha512;
  }, "Desktop update metadata must select one artifact.");

/** Immutable candidate metadata; it never selects the default update channel. */
export const desktopCandidateManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  target: z.literal("production"),
  platform: z.literal("macos-arm64"),
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
});
export const DESKTOP_PROMOTED_RELEASE_KEY = "desktop/promoted.json";
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
  const artifactName = `OpenMeld-Desktop-${manifest.version}-macos-arm64.dmg`;
  return {
    artifactName,
    objectKey: `desktop/candidates/${manifest.sha256}/${artifactName}`,
    manifestKey: desktopCandidateManifestKey(manifest.sha256),
    downloadPath: `/desktop/download?candidate=${manifest.sha256}`,
    zipObjectKey: `desktop/candidates/${manifest.sha256}/OpenMeld-Desktop-${manifest.version}-macos-arm64.zip`,
    zipDownloadPath: `/desktop/updates/${manifest.sha256}/desktop.zip`,
  };
}

export function desktopCandidateManifestKey(candidate: string) {
  return `desktop/candidates/${desktopCandidateIdSchema.parse(candidate)}/manifest.json`;
}

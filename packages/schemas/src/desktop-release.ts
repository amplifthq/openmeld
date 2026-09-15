import { z } from "zod/v4";

export const desktopCandidateIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const desktopVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  .max(100);

/** Immutable candidate metadata; it never selects the default update channel. */
export const desktopCandidateManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  target: z.literal("production"),
  platform: z.literal("macos-arm64"),
  version: desktopVersionSchema,
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  sha256: desktopCandidateIdSchema,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
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
  };
}

export function desktopCandidateManifestKey(candidate: string) {
  return `desktop/candidates/${desktopCandidateIdSchema.parse(candidate)}/manifest.json`;
}

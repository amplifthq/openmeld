import * as z from "zod/v4";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

/** Build-time handoff only; this is not a publisher trust or runtime grant. */
export const windowsProcessArtifactSchema = z.strictObject({
  schemaVersion: z.literal(1),
  platform: z.literal("windows-x64"),
  sourceSha256: sha256,
  sha256,
  sizeBytes: z.number().int().positive(),
});

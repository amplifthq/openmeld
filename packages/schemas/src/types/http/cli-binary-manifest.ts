import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/cli-binary-manifest");

export type CliBinaryCompressedRelease = z.infer<
  Schemas["cliBinaryCompressedReleaseSchema"]
>;
export type CliBinaryDeltaPatch = z.infer<Schemas["cliBinaryDeltaPatchSchema"]>;
export type CliBinaryDeltaTransport = z.infer<
  Schemas["cliBinaryDeltaTransportSchema"]
>;
export type CliBinaryManifest = z.infer<Schemas["cliBinaryManifestSchema"]>;
export type CliBinaryRelease = z.infer<Schemas["cliBinaryReleaseSchema"]>;

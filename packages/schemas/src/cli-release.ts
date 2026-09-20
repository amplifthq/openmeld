import * as z from "zod/v4";
import { cliBinaryManifestSchema } from "./schemas/http/cli-binary-manifest";
export const CLI_RELEASE_PATH = "/v1/cli/release";
export const cliReleaseSchema = z.strictObject({
  version: cliBinaryManifestSchema.shape.channels.shape.stable.shape.version,
});
export type CliRelease = z.infer<typeof cliReleaseSchema>;

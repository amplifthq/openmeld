/** biome-ignore-all lint/style/noExportedImports: This package intentionally exposes a dedicated public client entrypoint. */
import type {
  CreateAuthClientConfigInput,
  OpenMeldAuthClientConfig,
} from "./configs/auth.client.config";
import { createAuthClientConfig as createAuthClientConfigInternal } from "./configs/auth.client.config";

export type { CreateAuthClientConfigInput, OpenMeldAuthClientConfig };

export const createAuthClientConfig = (
  input: CreateAuthClientConfigInput
): OpenMeldAuthClientConfig => {
  return createAuthClientConfigInternal(input);
};

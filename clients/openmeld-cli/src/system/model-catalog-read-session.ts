import type { ModelCatalog } from "@openmeld/schemas/types";
import { readEmbeddedModelCatalog } from "../model-catalog/embedded";

export type ModelCatalogReadSession = {
  read: () => Promise<ModelCatalog>;
};

export function createModelCatalogReadSession(input?: {
  baseUrl?: string;
}): ModelCatalogReadSession {
  let readPromise: Promise<ModelCatalog> | null = null;
  return {
    read: () => {
      readPromise ??= readModelCatalogOnce(input?.baseUrl);
      return readPromise;
    },
  };
}

async function readModelCatalogOnce(baseUrl?: string): Promise<ModelCatalog> {
  try {
    const [apiClient, baseUrlModule, clientFoundationModule] =
      await Promise.all([
        import("@openmeld/api-client"),
        import("../config/base-url"),
        import("../space/api-client-foundation"),
      ]);
    if (typeof apiClient.createConfigApi !== "function") {
      throw new Error("config api client is unavailable");
    }
    const resolvedBaseUrl = baseUrl ?? (await baseUrlModule.resolveBaseUrl());
    const response = await apiClient
      .createConfigApi(
        clientFoundationModule.createCliApiClientFoundation(resolvedBaseUrl)
      )
      .getModelCatalog();
    return response;
  } catch {
    return readEmbeddedModelCatalog();
  }
}

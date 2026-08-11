import type { GetModelCatalogResponse } from "@openmeld/schemas/types";

export type ConfigApi = {
  getModelCatalog: () => Promise<GetModelCatalogResponse>;
};

export type CreateConfigApi = (
  client: import("../client").OpenMeldApiClientFoundation
) => ConfigApi;

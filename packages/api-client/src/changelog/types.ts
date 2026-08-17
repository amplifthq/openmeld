import type {
  ChangelogQuery,
  ChangelogQueryResponse,
} from "@openmeld/schemas/types";

export type ChangelogApi = {
  readChangelog: (query?: ChangelogQuery) => Promise<ChangelogQueryResponse>;
};

export type CreateChangelogApi = (
  client: import("../client").OpenMeldApiClientFoundation
) => ChangelogApi;

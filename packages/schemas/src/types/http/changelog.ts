import type { z } from "zod/v4";

type ChangelogSchemas = typeof import("../../schemas/http/changelog");

export type ChangelogEntry = z.infer<ChangelogSchemas["changelogEntrySchema"]>;
export type ChangelogEntryKind = z.infer<
  ChangelogSchemas["changelogEntryKindSchema"]
>;
export type ChangelogIndex = z.infer<ChangelogSchemas["changelogIndexSchema"]>;
export type ChangelogQuery = z.infer<ChangelogSchemas["changelogQuerySchema"]>;
export type ChangelogQueryResponse = z.infer<
  ChangelogSchemas["changelogQueryResponseSchema"]
>;
export type ChangelogSource = z.infer<
  ChangelogSchemas["changelogSourceSchema"]
>;
export type CenterAgentReadChangelogToolRpcInput = z.infer<
  ChangelogSchemas["centerAgentReadChangelogToolRpcInputSchema"]
>;

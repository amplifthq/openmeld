import type { z } from "zod/v4";

type CenterAgentContextManifestSchemas =
  typeof import("../../schemas/http/center-agent-context-manifest");

export type CenterAgentContextManifestEntry = z.infer<
  CenterAgentContextManifestSchemas["centerAgentContextManifestEntrySchema"]
>;
export type CenterAgentContextManifestMaterialization = z.infer<
  CenterAgentContextManifestSchemas["centerAgentContextManifestMaterializationSchema"]
>;
export type CenterAgentContextManifestSourceRef = z.infer<
  CenterAgentContextManifestSchemas["centerAgentContextManifestSourceRefSchema"]
>;
export type CenterAgentContextLoadSelectedEntry = z.infer<
  CenterAgentContextManifestSchemas["centerAgentContextLoadSelectedEntrySchema"]
>;
export type CenterAgentContextLoadSelection = z.infer<
  CenterAgentContextManifestSchemas["centerAgentContextLoadSelectionSchema"]
>;
export type CenterAgentContextManifestView = z.infer<
  CenterAgentContextManifestSchemas["centerAgentContextManifestViewSchema"]
>;
export type CreateCenterAgentContextManifestBody = z.input<
  CenterAgentContextManifestSchemas["createCenterAgentContextManifestBodySchema"]
>;
export type CreateCenterAgentContextManifestResponse = z.infer<
  CenterAgentContextManifestSchemas["createCenterAgentContextManifestResponseSchema"]
>;
export type CreateCenterAgentContextLoadReceiptBody = z.input<
  CenterAgentContextManifestSchemas["createCenterAgentContextLoadReceiptBodySchema"]
>;
export type CreateCenterAgentContextLoadReceiptResponse = z.infer<
  CenterAgentContextManifestSchemas["createCenterAgentContextLoadReceiptResponseSchema"]
>;

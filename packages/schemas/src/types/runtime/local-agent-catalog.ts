import type { z } from "zod/v4";

type LocalAgentCatalogEntrySchema =
  typeof import("../../schemas/runtime/local-agent-catalog")["localAgentCatalogEntrySchema"];
type LocalAgentCatalogEntryWithLifecycleSchema =
  typeof import("../../schemas/runtime/local-agent-catalog")["localAgentCatalogEntryWithLifecycleSchema"];
type LocalAgentCatalogLaunchStatusSchema =
  typeof import("../../schemas/runtime/local-agent-catalog")["localAgentCatalogLaunchStatusSchema"];
type LocalAgentCatalogLifecycleStatusSchema =
  typeof import("../../schemas/runtime/local-agent-catalog")["localAgentCatalogLifecycleStatusSchema"];
type LocalAgentCatalogSchema =
  typeof import("../../schemas/runtime/local-agent-catalog")["localAgentCatalogSchema"];
type LocalAgentCatalogWithLifecycleSchema =
  typeof import("../../schemas/runtime/local-agent-catalog")["localAgentCatalogWithLifecycleSchema"];
type LocalAgentCatalogSelectableReasonSchema =
  typeof import("../../schemas/runtime/local-agent-catalog")["localAgentCatalogSelectableReasonSchema"];
type LocalAgentCatalogTargetKindSchema =
  typeof import("../../schemas/runtime/local-agent-catalog")["localAgentCatalogTargetKindSchema"];

export type LocalAgentCatalog = z.infer<LocalAgentCatalogSchema>;
export type LocalAgentCatalogEntry = z.infer<LocalAgentCatalogEntrySchema>;
export type LocalAgentCatalogEntryWithLifecycle =
  z.infer<LocalAgentCatalogEntryWithLifecycleSchema>;
export type LocalAgentCatalogWithLifecycle =
  z.infer<LocalAgentCatalogWithLifecycleSchema>;
export type LocalAgentCatalogLaunchStatus =
  z.infer<LocalAgentCatalogLaunchStatusSchema>;
export type LocalAgentCatalogLifecycleStatus =
  z.infer<LocalAgentCatalogLifecycleStatusSchema>;
export type LocalAgentCatalogSelectableReason =
  z.infer<LocalAgentCatalogSelectableReasonSchema>;
export type LocalAgentCatalogTargetKind =
  z.infer<LocalAgentCatalogTargetKindSchema>;

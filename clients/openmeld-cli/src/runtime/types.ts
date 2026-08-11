import type { ProfileKind } from "@openmeld/protocol";
import type { RuntimeViewCustomization } from "../config/runtime-config";

export type CliViewMode = "auto" | "human" | "agent";
export type ResolvedCliView = Exclude<CliViewMode, "auto">;

export type RuntimeContext = {
  viewMode: CliViewMode;
  resolvedView: ResolvedCliView;
  interactive: boolean;
  openMeldProfileId?: string;
  profileKind?: ProfileKind;
  viewCustomization?: RuntimeViewCustomization;
};

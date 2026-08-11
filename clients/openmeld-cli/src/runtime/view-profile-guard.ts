export type SupportedCliView = "human" | "agent";
export type SupportedProfileKind = "human" | "agent" | "system";

export function isProfileKindAllowedInView(input: {
  resolvedView: SupportedCliView;
  profileKind: SupportedProfileKind;
}): boolean {
  if (input.resolvedView !== "agent") {
    return true;
  }
  return input.profileKind === "human" || input.profileKind === "agent";
}

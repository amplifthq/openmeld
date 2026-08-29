import type { SpaceMeta } from "@openmeld/protocol";

export type SpaceAccessPresentationInput = Pick<
  SpaceMeta,
  "accessMode" | "passwordProtected"
> &
  Partial<Pick<SpaceMeta, "visibility">>;

export function resolveOrganizationVisibilityLabel(
  visibility: SpaceMeta["visibility"]
): string {
  return visibility === "public"
    ? "discoverable; Organization members can join"
    : "invite only";
}

export function resolveLinkAccessLabel(
  input: SpaceAccessPresentationInput
): string {
  switch (input.accessMode) {
    case "members_only":
      return "members only";
    case "public":
      return "anyone with the link";
    case "public_view_join_password":
      return "anyone can view; password required to join";
    case "protected":
      return "password required to view and join";
    default:
      if (input.passwordProtected === true) {
        return "password required";
      }
      if (input.passwordProtected === false) {
        return "anyone with the link";
      }
      return "unknown";
  }
}

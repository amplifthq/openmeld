import { fileRootSchema } from "@openmeld/schemas";
import type { FileRoot } from "@openmeld/schemas/types";

export type OrganizationFileRoot = Exclude<FileRoot, { kind: "space" }>;

/** Team and member roots have separate writers; Space keeps its existing writer. */
export function organizationFileRootName(
  rawRoot: OrganizationFileRoot
): string {
  const root = fileRootSchema.parse(rawRoot);
  if (root.kind === "space") {
    throw new Error("Space Files belong to the Space Durable Object.");
  }
  return JSON.stringify(
    root.kind === "team"
      ? ["files", "team", root.organizationId]
      : ["files", "member", root.organizationId, root.memberUserId]
  );
}

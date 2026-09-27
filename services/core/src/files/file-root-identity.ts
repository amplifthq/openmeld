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

export function buildOrganizationFileObjectKey(input: {
  root: OrganizationFileRoot;
  fileId: string;
  revisionId: string;
}): string {
  const root = fileRootSchema.parse(input.root);
  if (root.kind === "space") {
    throw new Error("Space revisions use the Space object key.");
  }
  const location =
    root.kind === "team"
      ? "team"
      : `member/${encodeURIComponent(root.memberUserId)}`;
  return `org/${encodeURIComponent(root.organizationId)}/file-roots/${location}/files/${encodeURIComponent(input.fileId)}/revisions/${encodeURIComponent(input.revisionId)}`;
}

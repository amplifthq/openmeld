import type { WorkspaceClient } from "@cloudflare/computer";
import { centerAgentOrganizationDocumentsComputerSnapshotResponseSchema } from "@openmeld/schemas";
import type { CenterAgentOrganizationDocumentsComputerSnapshotResponse } from "@openmeld/schemas/types";

export const ORGANIZATION_DOCUMENTS_COMPUTER_ROOT = "/computer/org/documents";
export const ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST = `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/.openmeld-documents.json`;

const INVALID_PATH_CHARACTERS_PATTERN = /[\\/:*?"<>|]/gu;
const REPEATED_SEPARATOR_PATTERN = /[-\s]+/gu;
const LEADING_OR_TRAILING_DOTS_PATTERN = /^\.+|\.+$/gu;
const TRAILING_DASHES_PATTERN = /-+$/u;
const UNSAFE_ID_CHARACTERS_PATTERN = /[^A-Za-z0-9_-]/gu;
const MAX_VISIBLE_PATH_SEGMENT_CHARS = 96;
const MAX_VISIBLE_ID_CHARS = 80;

/** Trusted turn-local data. No approved document is automatically exported to disk. */
export type OrganizationDocumentsComputerSnapshot = {
  documents: Array<{
    content: string;
    id: string;
    kind: CenterAgentOrganizationDocumentsComputerSnapshotResponse["documents"][number]["kind"];
    fileName: string;
    title: string;
    updatedAt: string;
  }>;
  organizationId: string;
  revision: string;
};

export function prepareOrganizationDocumentsComputerSnapshot(
  rawSnapshot: CenterAgentOrganizationDocumentsComputerSnapshotResponse
): OrganizationDocumentsComputerSnapshot {
  const snapshot =
    centerAgentOrganizationDocumentsComputerSnapshotResponseSchema.parse(
      rawSnapshot
    );
  const folderPaths = buildFolderPaths(snapshot);

  const projectedDocuments = snapshot.documents.map((document) => {
    const path = buildDocumentPath(document, folderPaths);
    return {
      content: document.content,
      id: document.id,
      kind: document.kind,
      fileName: path.slice(path.lastIndexOf("/") + 1),
      title: document.title,
      updatedAt: document.updatedAt,
    };
  });
  requireUniquePaths(projectedDocuments.map(({ fileName }) => fileName));

  return {
    documents: projectedDocuments,
    organizationId: snapshot.organizationId,
    revision: snapshot.revision,
  };
}

export async function clearLegacyOrganizationDocumentsComputerProjection(
  workspace: Pick<WorkspaceClient, "fs">
): Promise<void> {
  // The pinned Computer VFS removes a subtree synchronously. No chmod/mkdir
  // sequence can race another turn; force makes an already-retired root safe.
  await workspace.fs.rm(ORGANIZATION_DOCUMENTS_COMPUTER_ROOT, {
    force: true,
    recursive: true,
  });
}

function buildFolderPaths(
  snapshot: CenterAgentOrganizationDocumentsComputerSnapshotResponse
): Map<string, string> {
  const folders = new Map(
    snapshot.folders.map((folder) => [folder.id, folder])
  );
  const paths = new Map<string, string>();
  const visiting = new Set<string>();
  const resolve = (folderId: string): string => {
    const existing = paths.get(folderId);
    if (existing) {
      return existing;
    }
    if (visiting.has(folderId)) {
      throw new Error(
        "Organization Documents projection contains a folder cycle."
      );
    }
    const folder = folders.get(folderId);
    if (!folder) {
      throw new Error(
        `Organization Documents projection is missing folder ${folderId}.`
      );
    }
    visiting.add(folderId);
    const parent = folder.parentFolderId
      ? resolve(folder.parentFolderId)
      : ORGANIZATION_DOCUMENTS_COMPUTER_ROOT;
    const path = `${parent}/${buildStablePathSegment(folder.name, folder.id)}`;
    visiting.delete(folderId);
    paths.set(folderId, path);
    return path;
  };
  for (const folder of snapshot.folders) {
    resolve(folder.id);
  }
  requireUniquePaths([...paths.values()]);
  return paths;
}

function buildDocumentPath(
  document: CenterAgentOrganizationDocumentsComputerSnapshotResponse["documents"][number],
  folderPaths: ReadonlyMap<string, string>
): string {
  const parent = document.folderId
    ? folderPaths.get(document.folderId)
    : ORGANIZATION_DOCUMENTS_COMPUTER_ROOT;
  if (!parent) {
    throw new Error(
      `Organization Document ${document.id} references a missing folder.`
    );
  }
  return `${parent}/${buildStablePathSegment(document.title, document.id)}.md`;
}

function buildStablePathSegment(label: string, id: string): string {
  const visible = label
    .normalize("NFKC")
    .split("")
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? "-" : character;
    })
    .join("")
    .replace(INVALID_PATH_CHARACTERS_PATTERN, "-")
    .replace(REPEATED_SEPARATOR_PATTERN, "-")
    .replace(LEADING_OR_TRAILING_DOTS_PATTERN, "")
    .slice(0, MAX_VISIBLE_PATH_SEGMENT_CHARS)
    .replace(TRAILING_DASHES_PATTERN, "");
  const normalizedId = id.replace(UNSAFE_ID_CHARACTERS_PATTERN, "-");
  const stableId =
    normalizedId.length <= MAX_VISIBLE_ID_CHARS
      ? normalizedId
      : `${normalizedId.slice(0, MAX_VISIBLE_ID_CHARS)}-${stableStringHash(id)}`;
  if (!(visible && stableId)) {
    throw new Error(
      "Organization Documents projection requires safe document and folder identities."
    );
  }
  return `${visible}--${stableId}`;
}

function stableStringHash(value: string): string {
  let hash = 5381;
  for (const character of value) {
    hash = (hash * 33 + (character.codePointAt(0) ?? 0)) % 4_294_967_291;
  }
  return hash.toString(16).padStart(8, "0");
}

function requireUniquePaths(paths: readonly string[]): void {
  const unique = new Set(paths);
  if (unique.size !== paths.length) {
    throw new Error(
      "Organization Documents projection produced duplicate filesystem paths."
    );
  }
}

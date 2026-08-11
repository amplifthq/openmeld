import type { WorkspaceClient } from "@cloudflare/computer";
import { centerAgentOrganizationDocumentsComputerSnapshotResponseSchema } from "@openmeld/schemas";
import type { CenterAgentOrganizationDocumentsComputerSnapshotResponse } from "@openmeld/schemas/types";

export const ORGANIZATION_DOCUMENTS_COMPUTER_ROOT = "/computer/org/documents";
export const ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST = `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/.openmeld-documents.json`;

const MANIFEST_SCHEMA = "openmeld-organization-documents-projection-v1";
const READ_ONLY_DIRECTORY_MODE = 0o555;
const READ_ONLY_FILE_MODE = 0o444;
const WRITABLE_DIRECTORY_MODE = 0o755;
const INVALID_PATH_CHARACTERS_PATTERN = /[\\/:*?"<>|]/gu;
const REPEATED_SEPARATOR_PATTERN = /[-\s]+/gu;
const LEADING_OR_TRAILING_DOTS_PATTERN = /^\.+|\.+$/gu;
const TRAILING_DASHES_PATTERN = /-+$/u;
const UNSAFE_ID_CHARACTERS_PATTERN = /[^A-Za-z0-9_-]/gu;
const MAX_VISIBLE_PATH_SEGMENT_CHARS = 96;
const MAX_VISIBLE_ID_CHARS = 80;

export type OrganizationDocumentProjectionManifest = {
  documents: Array<{
    id: string;
    kind: CenterAgentOrganizationDocumentsComputerSnapshotResponse["documents"][number]["kind"];
    path: string;
    title: string;
    updatedAt: string;
  }>;
  organizationId: string;
  readOnly: true;
  revision: string;
  schema: typeof MANIFEST_SCHEMA;
};

export type OrganizationDocumentsComputerProjection = {
  documents: Array<
    OrganizationDocumentProjectionManifest["documents"][number] & {
      content: string;
    }
  >;
  organizationId: string;
  revision: string;
};

export async function materializeOrganizationDocumentsComputerProjection(
  workspace: Pick<WorkspaceClient, "fs">,
  rawSnapshot: CenterAgentOrganizationDocumentsComputerSnapshotResponse
): Promise<{
  documentCount: number;
  outcome: "updated";
  projection: OrganizationDocumentsComputerProjection;
  revision: string;
}> {
  const snapshot =
    centerAgentOrganizationDocumentsComputerSnapshotResponseSchema.parse(
      rawSnapshot
    );
  await resetProjectionRoot(workspace);
  const folderPaths = buildFolderPaths(snapshot);
  const directories = [
    ORGANIZATION_DOCUMENTS_COMPUTER_ROOT,
    ...new Set(folderPaths.values()),
  ].sort((left, right) => left.length - right.length);
  for (const directory of directories) {
    await workspace.fs.mkdir(directory, { recursive: true });
  }

  const projectedDocuments = snapshot.documents.map((document) => ({
    content: document.content,
    id: document.id,
    kind: document.kind,
    path: buildDocumentPath(document, folderPaths),
    title: document.title,
    updatedAt: document.updatedAt,
  }));
  requireUniquePaths(projectedDocuments.map(({ path }) => path));
  for (const document of projectedDocuments) {
    await workspace.fs.writeFile(document.path, document.content);
  }

  const manifest: OrganizationDocumentProjectionManifest = {
    documents: projectedDocuments.map((document) => ({
      id: document.id,
      kind: document.kind,
      path: document.path,
      title: document.title,
      updatedAt: document.updatedAt,
    })),
    organizationId: snapshot.organizationId,
    readOnly: true,
    revision: snapshot.revision,
    schema: MANIFEST_SCHEMA,
  };
  await workspace.fs.writeFile(
    ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST,
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  for (const document of projectedDocuments) {
    await workspace.fs.chmod(document.path, READ_ONLY_FILE_MODE);
  }
  await workspace.fs.chmod(
    ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST,
    READ_ONLY_FILE_MODE
  );
  for (const directory of [...directories].reverse()) {
    await workspace.fs.chmod(directory, READ_ONLY_DIRECTORY_MODE);
  }

  return {
    documentCount: projectedDocuments.length,
    outcome: "updated",
    projection: {
      documents: projectedDocuments,
      organizationId: snapshot.organizationId,
      revision: snapshot.revision,
    },
    revision: snapshot.revision,
  };
}

export async function clearOrganizationDocumentsComputerProjection(
  workspace: Pick<WorkspaceClient, "fs">
): Promise<void> {
  await resetProjectionRoot(workspace);
  await workspace.fs.chmod(
    ORGANIZATION_DOCUMENTS_COMPUTER_ROOT,
    READ_ONLY_DIRECTORY_MODE
  );
}

async function resetProjectionRoot(
  workspace: Pick<WorkspaceClient, "fs">
): Promise<void> {
  try {
    await workspace.fs.chmod(
      ORGANIZATION_DOCUMENTS_COMPUTER_ROOT,
      WRITABLE_DIRECTORY_MODE
    );
  } catch {
    // A missing first-run projection is the normal path.
  }
  await workspace.fs.rm(ORGANIZATION_DOCUMENTS_COMPUTER_ROOT, {
    force: true,
    recursive: true,
  });
  await workspace.fs.mkdir(ORGANIZATION_DOCUMENTS_COMPUTER_ROOT, {
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

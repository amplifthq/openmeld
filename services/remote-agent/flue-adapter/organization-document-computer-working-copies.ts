import type { WorkspaceClient } from "@cloudflare/computer";
import type { OrganizationDocumentsComputerProjection } from "./organization-document-computer-projection";

const WORKING_COPY_DIRECTORY_NAME = "documents";
const SAFE_VERSION_CHARACTER_PATTERN = /[^A-Za-z0-9]/gu;
const TRAILING_SLASHES_PATTERN = /\/+$/u;

type ProjectedDocument =
  OrganizationDocumentsComputerProjection["documents"][number];

export type OrganizationDocumentComputerWorkingCopyStore = {
  checkout(documentId: string): Promise<{
    baseUpdatedAt: string;
    documentId: string;
    outcome: "created" | "existing";
    path: string;
    title: string;
  }>;
  read(path: string): Promise<{
    baseUpdatedAt: string;
    content: string;
    documentId: string;
    path: string;
    title: string;
  }>;
};

export function createOrganizationDocumentComputerWorkingCopyStore(input: {
  projection: OrganizationDocumentsComputerProjection;
  workingDirectory: string;
  workspace: Pick<WorkspaceClient, "fs">;
}): OrganizationDocumentComputerWorkingCopyStore {
  const workingCopyRoot = `${withoutTrailingSlashes(input.workingDirectory)}/${WORKING_COPY_DIRECTORY_NAME}`;
  return {
    async checkout(documentId) {
      const document = requireProjectedDocument(input.projection, documentId);
      const path = buildWorkingCopyPath(workingCopyRoot, document);
      if (await fileExists(input.workspace, path)) {
        return {
          baseUpdatedAt: document.updatedAt,
          documentId: document.id,
          outcome: "existing",
          path,
          title: document.title,
        };
      }

      await input.workspace.fs.mkdir(workingCopyRoot, { recursive: true });
      await input.workspace.fs.writeFile(path, document.content);
      return {
        baseUpdatedAt: document.updatedAt,
        documentId: document.id,
        outcome: "created",
        path,
        title: document.title,
      };
    },

    async read(path) {
      requirePathInsideWorkingCopyRoot(path, workingCopyRoot);
      const document = input.projection.documents.find(
        (candidate) => buildWorkingCopyPath(workingCopyRoot, candidate) === path
      );
      if (!document) {
        throw new Error(
          `${path} is not a working copy of a current approved Organization Document. Check out the latest Document before submitting it.`
        );
      }
      return {
        baseUpdatedAt: document.updatedAt,
        content: await input.workspace.fs.readFile(path, "utf8"),
        documentId: document.id,
        path,
        title: document.title,
      };
    },
  };
}

function requireProjectedDocument(
  projection: OrganizationDocumentsComputerProjection,
  documentId: string
): ProjectedDocument {
  const document = projection.documents.find((item) => item.id === documentId);
  if (!document) {
    throw new Error(
      `Organization Document ${documentId} is not in the current Computer projection.`
    );
  }
  return document;
}

function buildWorkingCopyPath(
  workingCopyRoot: string,
  document: ProjectedDocument
): string {
  const sourceFileName = document.path.split("/").at(-1);
  if (!sourceFileName?.endsWith(".md")) {
    throw new Error(
      `Organization Document ${document.id} has an invalid Computer path.`
    );
  }
  const version = document.updatedAt.replace(
    SAFE_VERSION_CHARACTER_PATTERN,
    ""
  );
  return `${workingCopyRoot}/${sourceFileName.slice(0, -3)}--${version}.md`;
}

async function fileExists(
  workspace: Pick<WorkspaceClient, "fs">,
  path: string
): Promise<boolean> {
  try {
    await workspace.fs.readFile(path, "utf8");
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function requirePathInsideWorkingCopyRoot(
  path: string,
  workingCopyRoot: string
): void {
  if (
    !path.startsWith(`${workingCopyRoot}/`) ||
    path.includes("/../") ||
    path.endsWith("/..")
  ) {
    throw new Error(
      `Organization Document working copies must stay inside ${workingCopyRoot}.`
    );
  }
}

function withoutTrailingSlashes(value: string): string {
  return value.replace(TRAILING_SLASHES_PATTERN, "");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

import type { WorkspaceClient } from "@cloudflare/computer";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationDocumentsComputerSnapshot } from "../flue-adapter/organization-document-computer-snapshot";
import { createOrganizationDocumentComputerWorkingCopyStore } from "../flue-adapter/organization-document-computer-working-copies";

const SOURCE_PATH =
  "/computer/org/documents/Plans--folder_plans/Launch-Plan--doc_launch.md";
const UPDATED_AT = "2026-08-08T10:00:00.000Z";

function createWorkspaceFake() {
  const files = new Map<string, string>();
  const directories = new Set<string>(["/"]);
  const fs = {
    mkdir: vi.fn((path: string) => {
      directories.add(path);
      return Promise.resolve();
    }),
    readFile: vi.fn((path: string, encoding?: unknown) => {
      const content = files.get(path);
      if (content === undefined) {
        return Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
        );
      }
      if (encoding === "utf8") {
        return Promise.resolve(content);
      }
      return Promise.resolve(new Blob([content]).stream());
    }),
    writeFile: vi.fn((path: string, content: string | Uint8Array) => {
      files.set(
        path,
        typeof content === "string"
          ? content
          : new TextDecoder().decode(content)
      );
      return Promise.resolve();
    }),
  };
  files.set(SOURCE_PATH, "# Approved launch plan\n");
  return {
    directories,
    files,
    workspace: { fs } as unknown as Pick<WorkspaceClient, "fs">,
  };
}

function createProjection(
  updatedAt = UPDATED_AT,
  content = "# Approved launch plan\n"
): OrganizationDocumentsComputerSnapshot {
  return {
    documents: [
      {
        content,
        id: "doc_launch",
        kind: "knowledge",
        fileName: "Launch-Plan--doc_launch.md",
        title: "Launch Plan",
        updatedAt,
      },
    ],
    organizationId: "org_acme",
    revision: "a".repeat(64),
  };
}

describe("Organization Document Computer working copies", () => {
  it("checks out exact Markdown and preserves edits when reopened", async () => {
    const fixture = createWorkspaceFake();
    const store = createOrganizationDocumentComputerWorkingCopyStore({
      projection: createProjection(),
      workingDirectory: "/computer/spaces/space_launch",
      workspace: fixture.workspace,
    });

    const checkout = await store.checkout("doc_launch");
    expect(checkout).toMatchObject({
      baseUpdatedAt: UPDATED_AT,
      documentId: "doc_launch",
      outcome: "created",
      title: "Launch Plan",
    });
    expect(fixture.files.get(checkout.path)).toBe("# Approved launch plan\n");
    expect(checkout.path).toContain("/computer/spaces/space_launch/documents/");

    fixture.files.set(checkout.path, "# Center Agent proposal\n");
    await expect(store.checkout("doc_launch")).resolves.toMatchObject({
      outcome: "existing",
      path: checkout.path,
    });
    await expect(store.read(checkout.path)).resolves.toMatchObject({
      baseUpdatedAt: UPDATED_AT,
      content: "# Center Agent proposal\n",
      documentId: "doc_launch",
      path: checkout.path,
    });
  });

  it("creates a separate path when the formal Document version changes", async () => {
    const fixture = createWorkspaceFake();
    const store = createOrganizationDocumentComputerWorkingCopyStore({
      projection: createProjection(),
      workingDirectory: "/computer/home",
      workspace: fixture.workspace,
    });
    const first = await store.checkout("doc_launch");
    const nextUpdatedAt = "2026-08-09T03:00:00.000Z";
    const nextStore = createOrganizationDocumentComputerWorkingCopyStore({
      projection: createProjection(
        nextUpdatedAt,
        "# Human's newer approved plan\n"
      ),
      workingDirectory: "/computer/home",
      workspace: fixture.workspace,
    });

    const second = await nextStore.checkout("doc_launch");
    expect(second.path).not.toBe(first.path);
    expect(fixture.files.get(first.path)).toBe("# Approved launch plan\n");
    expect(fixture.files.get(second.path)).toBe(
      "# Human's newer approved plan\n"
    );
  });

  it("rejects arbitrary Computer files without trusted checkout metadata", async () => {
    const fixture = createWorkspaceFake();
    const store = createOrganizationDocumentComputerWorkingCopyStore({
      projection: createProjection(),
      workingDirectory: "/computer/spaces/space_launch",
      workspace: fixture.workspace,
    });
    const arbitraryPath =
      "/computer/spaces/space_launch/documents/arbitrary.md";
    fixture.files.set(arbitraryPath, "Untracked content");

    await expect(store.read(arbitraryPath)).rejects.toThrow(
      "is not a working copy of a current approved Organization Document"
    );
    await expect(store.read("/computer/home/private.md")).rejects.toThrow(
      "must stay inside"
    );
  });

  it("does not trust agent-writable sidecar metadata for document identity", async () => {
    const fixture = createWorkspaceFake();
    const store = createOrganizationDocumentComputerWorkingCopyStore({
      projection: createProjection(),
      workingDirectory: "/computer/spaces/space_launch",
      workspace: fixture.workspace,
    });
    const checkout = await store.checkout("doc_launch");
    const sidecarPath = `${checkout.path}.openmeld.json`;
    expect(fixture.files.has(sidecarPath)).toBe(false);

    fixture.files.set(
      sidecarPath,
      JSON.stringify({
        baseUpdatedAt: UPDATED_AT,
        documentId: "doc_other",
        organizationId: "org_acme",
        schema: "openmeld-organization-document-working-copy-v1",
        sourcePath: "/computer/org/documents/Other--doc_other.md",
        title: "Other",
        workingCopyPath: checkout.path,
      })
    );

    await expect(store.read(checkout.path)).resolves.toMatchObject({
      baseUpdatedAt: UPDATED_AT,
      documentId: "doc_launch",
      title: "Launch Plan",
    });
  });
});

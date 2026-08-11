import type { WorkspaceClient } from "@cloudflare/computer";
import type { CenterAgentOrganizationDocumentsComputerSnapshotResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  materializeOrganizationDocumentsComputerProjection,
  ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST,
  ORGANIZATION_DOCUMENTS_COMPUTER_ROOT,
} from "../flue-adapter/organization-document-computer-projection";

function createWorkspaceFake() {
  const files = new Map<string, string>();
  const modes = new Map<string, number>();
  const directories = new Set<string>(["/"]);
  const writeFile = vi.fn((path: string, content: string | Uint8Array) => {
    files.set(
      path,
      typeof content === "string" ? content : new TextDecoder().decode(content)
    );
    return Promise.resolve();
  });
  const readFile = vi.fn((path: string, encoding?: unknown) => {
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
  });
  const fs = {
    chmod: vi.fn((path: string, mode: number) => {
      if (!(files.has(path) || directories.has(path))) {
        return Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
        );
      }
      modes.set(path, mode);
      return Promise.resolve();
    }),
    mkdir: vi.fn((path: string) => {
      directories.add(path);
      return Promise.resolve();
    }),
    readFile,
    rm: vi.fn((path: string) => {
      for (const file of files.keys()) {
        if (file === path || file.startsWith(`${path}/`)) {
          files.delete(file);
          modes.delete(file);
        }
      }
      for (const directory of directories) {
        if (directory === path || directory.startsWith(`${path}/`)) {
          directories.delete(directory);
          modes.delete(directory);
        }
      }
      return Promise.resolve();
    }),
    writeFile,
  };
  return {
    directories,
    files,
    modes,
    readFile,
    workspace: { fs } as unknown as Pick<WorkspaceClient, "fs">,
    writeFile,
  };
}

function snapshot(
  revision: string,
  content = "# Launch plan\n\n- Ship the durable Computer.\n"
): CenterAgentOrganizationDocumentsComputerSnapshotResponse {
  return {
    documents: [
      {
        content,
        folderId: "folder_plans",
        id: "doc_launch",
        kind: "knowledge",
        subjectUserId: null,
        title: "Launch Plan",
        updatedAt: "2026-08-08T10:00:00.000Z",
      },
    ],
    folders: [
      {
        createdAt: "2026-08-08T09:00:00.000Z",
        id: "folder_plans",
        name: "Plans",
        organizationId: "org_acme",
        parentFolderId: null,
        updatedAt: "2026-08-08T09:00:00.000Z",
      },
    ],
    organizationId: "org_acme",
    revision,
  };
}

describe("Organization Documents Computer projection", () => {
  it("writes exact approved Markdown into stable read-only paths", async () => {
    const fixture = createWorkspaceFake();
    const approvedContent =
      "# Launch plan\n\n| Owner | Status |\n| --- | --- |\n| Felix | Ready |\n";

    await expect(
      materializeOrganizationDocumentsComputerProjection(
        fixture.workspace,
        snapshot("a".repeat(64), approvedContent)
      )
    ).resolves.toMatchObject({
      documentCount: 1,
      outcome: "updated",
      revision: "a".repeat(64),
    });

    const documentPath = `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/Plans--folder_plans/Launch-Plan--doc_launch.md`;
    expect(fixture.files.get(documentPath)).toBe(approvedContent);
    expect(fixture.modes.get(documentPath)).toBe(0o444);
    expect(
      fixture.modes.get(
        `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/Plans--folder_plans`
      )
    ).toBe(0o555);
    expect(fixture.modes.get(ORGANIZATION_DOCUMENTS_COMPUTER_ROOT)).toBe(0o555);
    expect(
      JSON.parse(
        fixture.files.get(ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST) ?? "{}"
      )
    ).toMatchObject({
      documents: [
        {
          id: "doc_launch",
          path: documentPath,
          title: "Launch Plan",
        },
      ],
      organizationId: "org_acme",
      readOnly: true,
      revision: "a".repeat(64),
      schema: "openmeld-organization-documents-projection-v1",
    });
  });

  it("repairs agent-writable projection drift even when the Core revision is unchanged", async () => {
    const fixture = createWorkspaceFake();
    const initial = snapshot("b".repeat(64));
    await materializeOrganizationDocumentsComputerProjection(
      fixture.workspace,
      initial
    );
    const documentPath = `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/Plans--folder_plans/Launch-Plan--doc_launch.md`;
    fixture.files.set(documentPath, "# Agent-mutated projection\n");
    fixture.files.set(
      ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST,
      JSON.stringify({
        organizationId: "org_acme",
        readOnly: true,
        revision: "b".repeat(64),
        schema: "openmeld-organization-documents-projection-v1",
        documents: [],
      })
    );

    await expect(
      materializeOrganizationDocumentsComputerProjection(
        fixture.workspace,
        initial
      )
    ).resolves.toMatchObject({ outcome: "updated" });
    expect(fixture.files.get(documentPath)).toBe(initial.documents[0]?.content);
    expect(
      JSON.parse(
        fixture.files.get(ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST) ?? "{}"
      )
    ).toMatchObject({
      documents: [{ id: "doc_launch", path: documentPath }],
      revision: "b".repeat(64),
    });

    const stalePath = `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/stale.md`;
    fixture.files.set(stalePath, "stale");
    await expect(
      materializeOrganizationDocumentsComputerProjection(
        fixture.workspace,
        snapshot("c".repeat(64), "# Updated\n")
      )
    ).resolves.toMatchObject({ outcome: "updated" });
    expect(fixture.files.has(stalePath)).toBe(false);
    expect(
      fixture.files.get(
        `${ORGANIZATION_DOCUMENTS_COMPUTER_ROOT}/Plans--folder_plans/Launch-Plan--doc_launch.md`
      )
    ).toBe("# Updated\n");
  });

  it("fails closed when folder ownership cannot be projected safely", async () => {
    const fixture = createWorkspaceFake();
    const invalid = snapshot("d".repeat(64));
    const [folder] = invalid.folders;
    if (!folder) {
      throw new Error("Expected the snapshot fixture to contain one folder.");
    }
    invalid.folders[0] = {
      ...folder,
      parentFolderId: folder.id,
    };

    await expect(
      materializeOrganizationDocumentsComputerProjection(
        fixture.workspace,
        invalid
      )
    ).rejects.toThrow("folder cycle");
  });

  it("does not hide a Computer filesystem write failure", async () => {
    const fixture = createWorkspaceFake();
    fixture.writeFile.mockRejectedValueOnce(
      Object.assign(new Error("Computer storage unavailable"), { code: "EIO" })
    );

    await expect(
      materializeOrganizationDocumentsComputerProjection(
        fixture.workspace,
        snapshot("e".repeat(64))
      )
    ).rejects.toThrow("Computer storage unavailable");
  });

  it("keeps filesystem path segments bounded for long stable ids", async () => {
    const fixture = createWorkspaceFake();
    const longIdSnapshot = snapshot("f".repeat(64));
    const [document] = longIdSnapshot.documents;
    if (!document) {
      throw new Error("Expected the snapshot fixture to contain one document.");
    }
    document.id = `doc_${"x".repeat(252)}`;

    await materializeOrganizationDocumentsComputerProjection(
      fixture.workspace,
      longIdSnapshot
    );
    const manifest = JSON.parse(
      fixture.files.get(ORGANIZATION_DOCUMENTS_COMPUTER_MANIFEST) ?? "{}"
    ) as { documents?: Array<{ path?: string }> };
    const fileName = manifest.documents?.[0]?.path?.split("/").at(-1);
    expect(fileName).toBeTruthy();
    expect(fileName?.length).toBeLessThanOrEqual(255);
  });
});

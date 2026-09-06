import type { CenterAgentOrganizationDocumentsComputerSnapshotResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { prepareOrganizationDocumentsComputerSnapshot } from "../flue-adapter/organization-document-computer-snapshot";

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
        isManaged: false,
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

describe("Turn-local Organization Documents", () => {
  it("keeps independent trusted contents without exporting approved files", () => {
    const first = prepareOrganizationDocumentsComputerSnapshot(
      snapshot("a".repeat(64), "# First")
    );
    const second = prepareOrganizationDocumentsComputerSnapshot(
      snapshot("b".repeat(64), "# Second")
    );
    expect(first.documents[0]).toMatchObject({
      content: "# First",
      fileName: "Launch-Plan--doc_launch.md",
      id: "doc_launch",
    });
    expect(second.documents[0]?.content).toBe("# Second");
    expect(first.documents[0]?.content).toBe("# First");
  });

  it("rejects malformed folder ownership before exposing checkout", () => {
    const invalid = snapshot("c".repeat(64));
    const folder = invalid.folders[0];
    if (!folder) {
      throw new Error("Missing folder fixture");
    }
    folder.parentFolderId = folder.id;
    expect(() => prepareOrganizationDocumentsComputerSnapshot(invalid)).toThrow(
      "folder cycle"
    );
  });

  it("bounds working-copy filenames for long stable identities", () => {
    const input = snapshot("d".repeat(64));
    const document = input.documents[0];
    if (!document) {
      throw new Error("Missing document fixture");
    }
    document.id = `doc_${"x".repeat(252)}`;
    const prepared = prepareOrganizationDocumentsComputerSnapshot(input);
    expect(prepared.documents[0]?.fileName.length).toBeLessThanOrEqual(255);
  });
});

import { describe, expect, it } from "vitest";
import { renderTaskKnowledgeIndex } from "../src/task-knowledge";

describe("task knowledge display", () => {
  it("bounds the display while leaving a frozen release outside it usable", () => {
    const skills = [
      {
        skillId: "skill_tail",
        name: "invoice-review",
        releaseId: "release_7",
        digest: "a".repeat(64),
      },
    ];
    const before = structuredClone(skills);
    const documents = Array.from({ length: 50 }, (_, index) => ({
      id: `doc_${index}`,
      kind: "knowledge" as const,
      title: "Release checklist ".repeat(10),
      updatedAt: "2026-10-01T00:00:00Z",
    }));
    const result = renderTaskKnowledgeIndex({
      documents,
      skills,
      maxChars: 1000,
      readHint:
        "Full list: read_documents; Skill resources: activate by pinned name.",
    });
    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result).toContain("more visible entries omitted");
    expect(result).toContain("Full list: read_documents");
    expect(skills).toEqual(before);
  });

  it("distinguishes an unavailable directory from an authorized empty one", () => {
    const render = (documents: [] | null) =>
      renderTaskKnowledgeIndex({
        documents,
        skills: [],
        readHint: "Read current approved bodies with read_documents.",
      });
    expect(render(null)).toContain("directory unavailable");
    expect(render([])).not.toContain("directory unavailable");
    expect(render([])).toContain("0 more visible entries");
  });
});

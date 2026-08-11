// @vitest-environment jsdom
import { MarkdownPlugin } from "@platejs/markdown";
import { createPlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";
import { DocumentEditorKit } from "./plugins/document-editor-kit";

/**
 * Organization documents persist as CommonMark + GFM text that the Center
 * Agent, local agents, and humans all consume. These tests pin the editor's
 * core contract: loading Markdown into Plate and serializing it back must be
 * stable (idempotent) and must not destroy GFM structure or unknown syntax.
 */

function roundTrip(markdown: string): string {
	const editor = createPlateEditor({ plugins: DocumentEditorKit });
	const api = editor.getApi(MarkdownPlugin);
	editor.children = api.markdown.deserialize(markdown);
	return api.markdown.serialize();
}

const GFM_DOCUMENT = `# Profile Report

Felix is a **bold** and _italic_ builder with ~~old~~ new ideas and \`inline code\`.

## Working profile

> Focus: shipping the OpenMeld document system.

### Current focus

- Editor revamp
- Folder system
  - Nested item

1. First step
2. Second step

- [x] Ship editor
- [ ] Ship folders

| Source | Items | Confidence |
| ------ | ----- | ---------- |
| GitHub | 12    | High       |
| Slack  | 3     | Medium     |

\`\`\`ts
const answer = 42;
\`\`\`

---

See [OpenMeld](https://openmeld.dev) for details.
`;

describe("document editor markdown round-trip", () => {
	it("keeps every GFM structure through deserialize → serialize", () => {
		const output = roundTrip(GFM_DOCUMENT);

		expect(output).toContain("# Profile Report");
		expect(output).toContain("## Working profile");
		expect(output).toContain("### Current focus");
		expect(output).toContain("**bold**");
		expect(output).toContain("_italic_");
		expect(output).toContain("~~old~~");
		expect(output).toContain("`inline code`");
		expect(output).toContain("> Focus: shipping the OpenMeld document system.");
		expect(output).toContain("- Editor revamp");
		expect(output).toContain("Nested item");
		expect(output).toContain("1. First step");
		expect(output).toContain("[x] Ship editor");
		expect(output).toContain("[ ] Ship folders");
		expect(output).toContain("| Source |");
		expect(output).toContain("| GitHub |");
		expect(output).toContain("```ts");
		expect(output).toContain("const answer = 42;");
		expect(output).toContain("---");
		expect(output).toContain("[OpenMeld](https://openmeld.dev)");
	});

	it("is idempotent after the first normalization pass", () => {
		const once = roundTrip(GFM_DOCUMENT);
		const twice = roundTrip(once);

		expect(twice).toBe(once);
	});

	it("keeps unsupported syntax as plain text instead of rewriting it", () => {
		const markdown = [
			"Math like $E=mc^2$ stays text.",
			"",
			"Emoji shortcodes like :smile: stay text.",
		].join("\n");

		const output = roundTrip(markdown);

		expect(output).toContain("$E=mc^2$");
		expect(output).toContain(":smile:");
	});

	it("round-trips an empty document to empty markdown", () => {
		expect(roundTrip("").trim()).toBe("");
	});
});

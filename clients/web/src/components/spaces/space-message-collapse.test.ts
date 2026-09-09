import { describe, expect, it } from "vitest";
import { collapseSpaceMessage } from "./space-message-collapse";

describe("long message previews", () => {
	const introduction = `${"A complete sentence. ".repeat(180)}\n\n`;
	it("finishes the word and paragraph at the fold in Human messages", () => {
		const paragraph = `${"A sentence. ".repeat(333)}Tomorrow`;
		expect(
			collapseSpaceMessage(`${paragraph}\n\nHidden paragraph`, false)
		).toBe(paragraph);
	});
	it.each([
		`- First item\n- ${"A list item. ".repeat(35)}Tomorrow`,
		`\`\`\`ts\n${"const complete = true;\n".repeat(35)}\`\`\``,
		`| Name | Value |\n| --- | --- |\n${"| Tomorrow | Complete |\n".repeat(35)}`,
	])("preserves a complete Markdown block across the old limit", (block) => {
		expect(
			collapseSpaceMessage(`${introduction}${block}\n\nHidden paragraph`, true)
		).toBe(`${introduction}${block}`.trimEnd());
	});
	it("keeps reference definitions needed by visible text", () => {
		const paragraph = `${"A sentence. ".repeat(333)}[Tomorrow][day]`;
		expect(
			collapseSpaceMessage(
				`${paragraph}\n\nHidden paragraph\n\n[day]: https://example.com`,
				true
			)
		).toBe(`${paragraph}\n\n[day]: https://example.com`);
	});
	it("does not offer an empty expansion for a single oversized block", () => {
		const text = "Tomorrow ".repeat(600);
		expect(collapseSpaceMessage(text, true)).toBe(text);
	});
	it("leaves short messages and their whitespace unchanged", () => {
		expect(collapseSpaceMessage("Hello\n\n", true)).toBe("Hello\n\n");
	});
});

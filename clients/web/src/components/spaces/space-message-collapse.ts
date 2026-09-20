import { parseMarkdownIntoBlocks } from "streamdown";

export const SPACE_MESSAGE_LOCAL_COLLAPSE_THRESHOLD_CHARS = 2000;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:/;
const PARAGRAPH_BOUNDARY = /(?<=\n\n)/;

// The limit is soft: finish the paragraph, list, table, or code block before
// folding. A single large block stays intact rather than losing its structure.
export function collapseSpaceMessage(text: string, markdown: boolean): string {
	if (text.length <= SPACE_MESSAGE_LOCAL_COLLAPSE_THRESHOLD_CHARS) {
		return text;
	}
	const blocks = markdown
		? parseMarkdownIntoBlocks(text)
		: text.split(PARAGRAPH_BOUNDARY);
	let length = 0;
	let hasHiddenContent = false;
	const visible: string[] = [];
	const definitions: string[] = [];
	for (const block of blocks) {
		if (length < SPACE_MESSAGE_LOCAL_COLLAPSE_THRESHOLD_CHARS) {
			visible.push(block);
			length += block.length;
		} else if (markdown && REFERENCE_DEFINITION.test(block)) {
			// Reference links in visible blocks still need definitions below the fold.
			definitions.push(block);
		} else if (block.trim()) {
			hasHiddenContent = true;
		}
	}
	if (!hasHiddenContent) {
		return text;
	}
	const preview = visible.join("").trimEnd();
	return definitions.length
		? `${preview}\n\n${definitions.join("\n\n")}`
		: preview;
}

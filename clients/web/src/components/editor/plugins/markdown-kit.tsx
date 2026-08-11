import {
	BaseFootnoteDefinitionPlugin,
	BaseFootnoteReferencePlugin,
} from "@platejs/footnote";
import { MarkdownPlugin } from "@platejs/markdown";
import remarkGfm from "remark-gfm";

/**
 * Organization Documents and Skills persist as plain CommonMark + GFM so the
 * Center Agent, local agents, and humans all read the same clean Markdown.
 * MDX, math, emoji shortcodes, and mention syntax are intentionally left out;
 * unknown syntax stays untouched as plain text instead of being rewritten.
 */
export const MarkdownKit = [
	BaseFootnoteReferencePlugin,
	BaseFootnoteDefinitionPlugin,
	MarkdownPlugin.configure({
		options: {
			remarkPlugins: [remarkGfm],
			// Serialize with the conventional "-" bullets and "---" rules so
			// stored documents read naturally for humans and agents.
			remarkStringifyOptions: {
				bullet: "-",
				rule: "-",
			},
		},
	}),
];

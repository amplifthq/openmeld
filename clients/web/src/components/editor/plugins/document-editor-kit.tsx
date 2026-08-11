"use client";

import { TrailingBlockPlugin } from "platejs";

import { BasicBlocksKit } from "#/components/editor/plugins/basic-blocks-kit";
import { BlockPlaceholderKit } from "#/components/editor/plugins/block-placeholder-kit";
import { CodeBlockKit } from "#/components/editor/plugins/code-block-kit";
import { ExitBreakKit } from "#/components/editor/plugins/exit-break-kit";
import { FixedToolbarKit } from "#/components/editor/plugins/fixed-toolbar-kit";
import { FloatingToolbarKit } from "#/components/editor/plugins/floating-toolbar-kit";
import { LinkKit } from "#/components/editor/plugins/link-kit";
import { ListKit } from "#/components/editor/plugins/list-kit";
import { MarkdownKit } from "#/components/editor/plugins/markdown-kit";
import { MarksKit } from "#/components/editor/plugins/marks-kit";
import { SlashKit } from "#/components/editor/plugins/slash-kit";
import { TableKit } from "#/components/editor/plugins/table-kit";

/**
 * The one Plate configuration for Organization Markdown editing. Every plugin
 * here must round-trip through CommonMark + GFM; see markdown-kit.tsx.
 */
export const DocumentEditorKit = [
	...BasicBlocksKit,
	...MarksKit,
	...ListKit,
	...LinkKit,
	...CodeBlockKit,
	...TableKit,
	...MarkdownKit,
	...SlashKit,
	...BlockPlaceholderKit,
	...ExitBreakKit,
	...FixedToolbarKit,
	...FloatingToolbarKit,
	TrailingBlockPlugin,
];

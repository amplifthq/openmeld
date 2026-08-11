"use client";

import {
	BoldRules,
	CodeRules,
	ItalicRules,
	MarkComboRules,
	StrikethroughRules,
} from "@platejs/basic-nodes";
import {
	BoldPlugin,
	CodePlugin,
	ItalicPlugin,
	StrikethroughPlugin,
} from "@platejs/basic-nodes/react";

import { CodeLeaf } from "#/components/editor/ui/code-node";

/**
 * Marks are limited to what CommonMark + GFM can express so a document always
 * round-trips to clean Markdown for humans and agents alike.
 */
export const MarksKit = [
	BoldPlugin.configure({
		inputRules: [
			BoldRules.markdown({ variant: "*" }),
			BoldRules.markdown({ variant: "_" }),
			MarkComboRules.markdown({ variant: "boldItalic" }),
		],
	}),
	ItalicPlugin.configure({
		inputRules: [
			ItalicRules.markdown({ variant: "*" }),
			ItalicRules.markdown({ variant: "_" }),
		],
	}),
	CodePlugin.configure({
		inputRules: [CodeRules.markdown()],
		node: { component: CodeLeaf },
		shortcuts: { toggle: { keys: "mod+e" } },
	}),
	StrikethroughPlugin.configure({
		inputRules: [StrikethroughRules.markdown()],
		shortcuts: { toggle: { keys: "mod+shift+x" } },
	}),
];

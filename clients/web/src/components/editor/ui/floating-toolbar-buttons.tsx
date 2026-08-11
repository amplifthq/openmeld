"use client";

import {
	BoldIcon,
	CodeIcon,
	ItalicIcon,
	StrikethroughIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import { useEditorReadOnly } from "platejs/react";

import { LinkToolbarButton } from "./link-toolbar-button";
import { MarkToolbarButton } from "./mark-toolbar-button";
import { ToolbarGroup } from "./toolbar";
import { TurnIntoToolbarButton } from "./turn-into-toolbar-button";

export function FloatingToolbarButtons() {
	const readOnly = useEditorReadOnly();

	if (readOnly) {
		return null;
	}

	return (
		<>
			<ToolbarGroup>
				<TurnIntoToolbarButton />
			</ToolbarGroup>

			<ToolbarGroup>
				<MarkToolbarButton nodeType={KEYS.bold} tooltip="Bold (⌘+B)">
					<BoldIcon />
				</MarkToolbarButton>
				<MarkToolbarButton nodeType={KEYS.italic} tooltip="Italic (⌘+I)">
					<ItalicIcon />
				</MarkToolbarButton>
				<MarkToolbarButton
					nodeType={KEYS.strikethrough}
					tooltip="Strikethrough (⌘+⇧+X)"
				>
					<StrikethroughIcon />
				</MarkToolbarButton>
				<MarkToolbarButton nodeType={KEYS.code} tooltip="Code (⌘+E)">
					<CodeIcon />
				</MarkToolbarButton>
			</ToolbarGroup>

			<ToolbarGroup>
				<LinkToolbarButton />
			</ToolbarGroup>
		</>
	);
}

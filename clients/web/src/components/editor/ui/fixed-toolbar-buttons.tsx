"use client";

import {
	BoldIcon,
	CodeIcon,
	ItalicIcon,
	StrikethroughIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import { useEditorReadOnly } from "platejs/react";

import { RedoToolbarButton, UndoToolbarButton } from "./history-toolbar-button";
import { LinkToolbarButton } from "./link-toolbar-button";
import {
	BulletedListToolbarButton,
	NumberedListToolbarButton,
	TodoListToolbarButton,
} from "./list-toolbar-button";
import { MarkToolbarButton } from "./mark-toolbar-button";
import { ToolbarGroup } from "./toolbar";
import { TurnIntoToolbarButton } from "./turn-into-toolbar-button";

export function FixedToolbarButtons() {
	const readOnly = useEditorReadOnly();

	if (readOnly) {
		return null;
	}

	return (
		<div className="flex w-full">
			<ToolbarGroup>
				<UndoToolbarButton />
				<RedoToolbarButton />
			</ToolbarGroup>

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
				<BulletedListToolbarButton />
				<NumberedListToolbarButton />
				<TodoListToolbarButton />
			</ToolbarGroup>

			<ToolbarGroup>
				<LinkToolbarButton />
			</ToolbarGroup>
		</div>
	);
}

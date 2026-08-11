"use client";

import { ListStyleType, someList, toggleList } from "@platejs/list";
import {
	useIndentTodoToolBarButton,
	useIndentTodoToolBarButtonState,
} from "@platejs/list/react";
import { List, ListOrdered, ListTodoIcon } from "lucide-react";
import { KEYS } from "platejs";
import { useEditorRef, useEditorSelector } from "platejs/react";
import type * as React from "react";

import { ToolbarButton } from "./toolbar";

/**
 * Markdown keeps one bulleted and one numbered list style, so these are plain
 * toggles instead of the upstream split buttons with non-Markdown variants.
 */
export function BulletedListToolbarButton(
	props: React.ComponentProps<typeof ToolbarButton>
) {
	const editor = useEditorRef();
	const pressed = useEditorSelector(
		(e) => someList(e, [ListStyleType.Disc]),
		[]
	);

	return (
		<ToolbarButton
			{...props}
			onClick={() => {
				toggleList(editor, { listStyleType: ListStyleType.Disc });
			}}
			onMouseDown={(e) => e.preventDefault()}
			pressed={pressed}
			tooltip="Bulleted list"
		>
			<List />
		</ToolbarButton>
	);
}

export function NumberedListToolbarButton(
	props: React.ComponentProps<typeof ToolbarButton>
) {
	const editor = useEditorRef();
	const pressed = useEditorSelector(
		(e) => someList(e, [ListStyleType.Decimal]),
		[]
	);

	return (
		<ToolbarButton
			{...props}
			onClick={() => {
				toggleList(editor, { listStyleType: ListStyleType.Decimal });
			}}
			onMouseDown={(e) => e.preventDefault()}
			pressed={pressed}
			tooltip="Numbered list"
		>
			<ListOrdered />
		</ToolbarButton>
	);
}

export function TodoListToolbarButton(
	props: React.ComponentProps<typeof ToolbarButton>
) {
	const state = useIndentTodoToolBarButtonState({ nodeType: KEYS.listTodo });
	const { props: buttonProps } = useIndentTodoToolBarButton(state);

	return (
		<ToolbarButton {...props} {...buttonProps} tooltip="To-do list">
			<ListTodoIcon />
		</ToolbarButton>
	);
}

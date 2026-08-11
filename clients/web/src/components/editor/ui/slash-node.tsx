"use client";

import {
	Code2,
	Heading1Icon,
	Heading2Icon,
	Heading3Icon,
	ListIcon,
	ListOrdered,
	MinusIcon,
	PilcrowIcon,
	Quote,
	SquareCheckIcon,
	Table,
} from "lucide-react";
import { KEYS, type TComboboxInputElement } from "platejs";
import type { PlateEditor, PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";
import type * as React from "react";

import { insertBlock } from "#/components/editor/transforms";

import {
	InlineCombobox,
	InlineComboboxContent,
	InlineComboboxEmpty,
	InlineComboboxGroup,
	InlineComboboxGroupLabel,
	InlineComboboxInput,
	InlineComboboxItem,
} from "./inline-combobox";

type Group = {
	group: string;
	items: {
		icon: React.ReactNode;
		value: string;
		onSelect: (editor: PlateEditor, value: string) => void;
		className?: string;
		focusEditor?: boolean;
		keywords?: string[];
		label?: string;
	}[];
};

const groups: Group[] = [
	{
		group: "Blocks",
		items: [
			{
				icon: <PilcrowIcon />,
				keywords: ["paragraph"],
				label: "Text",
				value: KEYS.p,
			},
			{
				icon: <Heading1Icon />,
				keywords: ["title", "h1"],
				label: "Heading 1",
				value: KEYS.h1,
			},
			{
				icon: <Heading2Icon />,
				keywords: ["subtitle", "h2"],
				label: "Heading 2",
				value: KEYS.h2,
			},
			{
				icon: <Heading3Icon />,
				keywords: ["subtitle", "h3"],
				label: "Heading 3",
				value: KEYS.h3,
			},
			{
				icon: <Quote />,
				keywords: ["citation", "blockquote", "quote", ">"],
				label: "Blockquote",
				value: KEYS.blockquote,
			},
			{
				icon: <Code2 />,
				keywords: ["```"],
				label: "Code block",
				value: KEYS.codeBlock,
			},
			{
				icon: <Table />,
				label: "Table",
				value: KEYS.table,
			},
			{
				icon: <MinusIcon />,
				keywords: ["divider", "hr", "---"],
				label: "Divider",
				value: KEYS.hr,
			},
		].map((item) => ({
			...item,
			onSelect: (editor, value) => {
				insertBlock(editor, value, { upsert: true });
			},
		})),
	},
	{
		group: "Lists",
		items: [
			{
				icon: <ListIcon />,
				keywords: ["unordered", "ul", "-"],
				label: "Bulleted list",
				value: KEYS.ul,
			},
			{
				icon: <ListOrdered />,
				keywords: ["ordered", "ol", "1"],
				label: "Numbered list",
				value: KEYS.ol,
			},
			{
				icon: <SquareCheckIcon />,
				keywords: ["checklist", "task", "checkbox", "[]"],
				label: "To-do list",
				value: KEYS.listTodo,
			},
		].map((item) => ({
			...item,
			onSelect: (editor, value) => {
				insertBlock(editor, value, { upsert: true });
			},
		})),
	},
];

export function SlashInputElement(
	props: PlateElementProps<TComboboxInputElement>
) {
	const { editor, element } = props;

	return (
		<PlateElement {...props} as="span">
			<InlineCombobox element={element} trigger="/">
				<InlineComboboxInput />

				<InlineComboboxContent>
					<InlineComboboxEmpty>No results</InlineComboboxEmpty>

					{groups.map(({ group, items }) => (
						<InlineComboboxGroup key={group}>
							<InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>

							{items.map(
								({ focusEditor, icon, keywords, label, value, onSelect }) => (
									<InlineComboboxItem
										focusEditor={focusEditor}
										group={group}
										key={value}
										keywords={keywords}
										label={label}
										onClick={() => onSelect(editor, value)}
										value={value}
									>
										<div className="mr-2 text-muted-foreground">{icon}</div>
										{label ?? value}
									</InlineComboboxItem>
								)
							)}
						</InlineComboboxGroup>
					))}
				</InlineComboboxContent>
			</InlineCombobox>

			{props.children}
		</PlateElement>
	);
}

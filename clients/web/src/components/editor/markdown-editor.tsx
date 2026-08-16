"use client";

import { cn } from "@openmeld/ui/lib/utils";
import { MarkdownPlugin } from "@platejs/markdown";
import { Plate, usePlateEditor } from "platejs/react";
import { useRef } from "react";

import { DocumentEditorKit } from "#/components/editor/plugins/document-editor-kit";
import { Editor, EditorContainer } from "#/components/editor/ui/editor";

/**
 * The shared WYSIWYG Markdown surface for Organization Documents and
 * Organization Skills. Plate owns the rich editor state while callers persist
 * one CommonMark + GFM string.
 *
 * Remount with a new React key when loading externally changed content.
 */
export function MarkdownEditor(input: {
	ariaLabel?: string;
	disabled?: boolean;
	maxChars: number;
	onChange: (value: string) => void;
	placeholder?: string;
	value: string;
}) {
	const initialValue = useRef(input.value);
	const editor = usePlateEditor({
		plugins: DocumentEditorKit,
		value: (editorInstance) =>
			editorInstance
				.getApi(MarkdownPlugin)
				.markdown.deserialize(initialValue.current),
	});
	const contentLength = input.value.length;
	const overLimit = contentLength > input.maxChars;

	return (
		<div className="grid gap-2">
			<Plate
				editor={editor}
				onChange={({ editor: changedEditor }) => {
					input.onChange(
						changedEditor.getApi(MarkdownPlugin).markdown.serialize()
					);
				}}
				readOnly={input.disabled}
			>
				<EditorContainer>
					<Editor
						aria-label={input.ariaLabel}
						placeholder={
							input.placeholder ?? "Write, or press '/' for commands…"
						}
						variant="document"
					/>
				</EditorContainer>
			</Plate>
			<p
				className={cn(
					"text-muted-foreground text-xs",
					overLimit && "text-destructive"
				)}
			>
				{contentLength.toLocaleString("en-US")} /{" "}
				{input.maxChars.toLocaleString("en-US")} characters
				{overLimit ? " — too long to save" : ""}
			</p>
		</div>
	);
}

"use client";

import { cn } from "@openmeld/ui/lib/utils";
import { MarkdownPlugin } from "@platejs/markdown";
import { Plate, usePlateEditor } from "platejs/react";
import { useRef } from "react";

import { DocumentEditorKit } from "#/components/editor/plugins/document-editor-kit";
import { Editor, EditorContainer } from "#/components/editor/ui/editor";

/**
 * The shared WYSIWYG Markdown surface for Organization Documents,
 * Organization Skills, and Space Files. Plate owns the rich editor state while
 * callers persist one CommonMark + GFM string.
 *
 * Remount with a new React key when loading externally changed content.
 */
type MarkdownEditorContentLimit =
	| { maxBytes: number; maxChars?: never }
	| { maxBytes?: never; maxChars: number };

export type MarkdownEditorProps = {
	ariaLabel?: string;
	disabled?: boolean;
	onChange: (value: string) => void;
	placeholder?: string;
	value: string;
} & MarkdownEditorContentLimit;

export function MarkdownEditor(input: MarkdownEditorProps) {
	const initialValue = useRef(input.value);
	const editor = usePlateEditor({
		plugins: DocumentEditorKit,
		value: (editorInstance) =>
			editorInstance
				.getApi(MarkdownPlugin)
				.markdown.deserialize(initialValue.current),
	});
	const usesByteLimit = input.maxBytes !== undefined;
	const contentLength = usesByteLimit
		? new TextEncoder().encode(input.value).byteLength
		: input.value.length;
	const contentLimit = input.maxBytes ?? input.maxChars;
	const overLimit = contentLength > contentLimit;

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
				{usesByteLimit
					? `${formatBytes(contentLength)} / ${formatBytes(contentLimit)}`
					: `${contentLength.toLocaleString("en-US")} / ${contentLimit.toLocaleString("en-US")} characters`}
				{overLimit ? " — too long to save" : ""}
			</p>
		</div>
	);
}

function formatBytes(value: number): string {
	if (value < 1024) {
		return `${value.toLocaleString("en-US")} B`;
	}
	if (value < 1024 * 1024) {
		return `${(value / 1024).toLocaleString("en-US", {
			maximumFractionDigits: 1,
		})} KB`;
	}
	return `${(value / (1024 * 1024)).toLocaleString("en-US", {
		maximumFractionDigits: 1,
	})} MB`;
}

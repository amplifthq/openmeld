"use client";

import { Textarea } from "@openmeld/ui/components/textarea";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import { MarkdownPlugin } from "@platejs/markdown";
import { Plate, usePlateEditor } from "platejs/react";
import { Component, type ReactNode, useRef } from "react";
import { DocumentEditorKit } from "#/components/editor/plugins/document-editor-kit";
import { Editor, EditorContainer } from "#/components/editor/ui/editor";
import { FixedToolbar } from "#/components/editor/ui/fixed-toolbar";
import { FixedToolbarButtons } from "#/components/editor/ui/fixed-toolbar-buttons";
import { reportCaughtComponentError } from "#/lib/observability/application-error-client";

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
	/** Document canvas composition; other callers retain their existing chrome. */
	presentation?: "page";
	scrollable?: boolean;
	onChange: (value: string) => void;
	placeholder?: string;
	value: string;
} & MarkdownEditorContentLimit;

export function MarkdownEditor(input: MarkdownEditorProps) {
	const usesByteLimit = input.maxBytes !== undefined;
	const contentLength = usesByteLimit
		? new TextEncoder().encode(input.value).byteLength
		: input.value.length;
	const contentLimit = input.maxBytes ?? input.maxChars;
	const overLimit = contentLength > contentLimit;
	const showCount =
		input.presentation !== "page" || contentLength >= contentLimit * 0.9;

	return (
		<div
			className={cn(
				"gap-2",
				input.scrollable ? "flex min-h-0 flex-1 flex-col" : "grid",
				input.presentation === "page" && "min-w-0 grid-cols-[minmax(0,1fr)]"
			)}
		>
			<MarkdownEditorBoundary input={input}>
				<RichMarkdownEditor {...input} />
			</MarkdownEditorBoundary>
			{showCount && (
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
			)}
		</div>
	);
}

class MarkdownEditorBoundary extends Component<
	{ children: ReactNode; input: MarkdownEditorProps },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: Error) {
		reportCaughtComponentError(error, "markdown_editor");
	}

	render() {
		if (!this.state.failed) {
			return this.props.children;
		}
		const input = this.props.input;
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-2">
				<output className="text-muted-foreground text-sm">
					The editor stopped working. The Markdown is available below. Reload to
					try the editor again.
				</output>
				<Textarea
					aria-label={input.ariaLabel ?? "Markdown content"}
					className="min-h-64 flex-1 resize-none font-mono text-sm leading-6"
					onChange={(event) => input.onChange(event.currentTarget.value)}
					placeholder={input.placeholder}
					readOnly={input.disabled}
					spellCheck={false}
					value={input.value}
				/>
			</div>
		);
	}
}

function RichMarkdownEditor(input: MarkdownEditorProps) {
	const initialValue = useRef(input.value);
	const editor = usePlateEditor({
		plugins:
			input.scrollable || input.presentation === "page"
				? DocumentEditorKit.filter((plugin) => plugin.key !== "fixed-toolbar")
				: DocumentEditorKit,
		value: (editorInstance) =>
			editorInstance
				.getApi(MarkdownPlugin)
				.markdown.deserialize(initialValue.current),
	});
	return (
		<Plate
			editor={editor}
			// Selection and focus are not edits. Serializing them can normalize
			// untouched Markdown and incorrectly dirty the owning document.
			onValueChange={({ editor: changedEditor }) => {
				input.onChange(
					changedEditor.getApi(MarkdownPlugin).markdown.serialize()
				);
			}}
			readOnly={input.disabled}
		>
			{input.scrollable ? (
				<>
					<FixedToolbar className="shrink-0">
						<FixedToolbarButtons />
					</FixedToolbar>
					<ScrollArea className="min-h-0 flex-1">
						<EditorContainer className="h-auto overflow-visible">
							<Editor
								aria-label={input.ariaLabel}
								placeholder={
									input.placeholder ?? "Write, or press '/' for commands…"
								}
								variant="document"
							/>
						</EditorContainer>
					</ScrollArea>
				</>
			) : (
				<EditorContainer
					className={
						input.presentation === "page"
							? "h-auto overflow-visible"
							: undefined
					}
				>
					{input.presentation === "page" && (
						<FixedToolbar className="relative z-10 rounded-none">
							<FixedToolbarButtons />
						</FixedToolbar>
					)}
					<Editor
						aria-label={input.ariaLabel}
						className={
							input.presentation === "page"
								? "min-h-64 px-0 py-4 text-base leading-relaxed"
								: undefined
						}
						placeholder={
							input.placeholder ?? "Write, or press '/' for commands…"
						}
						variant="document"
					/>
				</EditorContainer>
			)}
		</Plate>
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

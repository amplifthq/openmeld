import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import {
	buildSpaceFileHtmlDocument,
	SPACE_FILE_HTML_PREVIEW_MAX_BYTES,
	SPACE_FILE_HTML_PREVIEW_NOTICE,
} from "./space-file-html-document";

export function SpaceFileHtmlPreview(input: {
	bytes: ArrayBuffer | null;
	draft: string | null;
	fileName: string;
	hasUnsavedChanges: boolean;
	isError: boolean;
	isLoading: boolean;
	newTabUrl?: string;
	onDownload: () => void;
	onRetry: () => void;
	sourceEditor: ReactNode;
}) {
	const [mode, setMode] = useState<"preview" | "source">("preview");
	const [preview, setPreview] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setPreview(null);
		setError(null);
		if (!input.bytes || mode === "source") {
			return;
		}
		if (input.bytes.byteLength > SPACE_FILE_HTML_PREVIEW_MAX_BYTES) {
			setError(
				"HTML previews are available for files up to 2 MiB. Download this file to open it on your computer."
			);
			return;
		}
		let source: string;
		try {
			// Fail visibly instead of silently replacing invalid source characters.
			source = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
		} catch {
			setError(
				"This HTML file isn’t UTF-8 encoded. Download it to open it on your computer."
			);
			return;
		}
		try {
			const previewSource = input.draft ?? source;
			if (
				new TextEncoder().encode(previewSource).byteLength >
				SPACE_FILE_HTML_PREVIEW_MAX_BYTES
			) {
				setError(
					"This draft is too large to preview. Reduce it to 2 MiB or less."
				);
				return;
			}
			setPreview(buildSpaceFileHtmlDocument(previewSource));
		} catch {
			setError(
				"This HTML preview couldn’t be prepared. Download the file to open it on your computer."
			);
			return;
		}
	}, [input.bytes, input.draft, mode]);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			{input.sourceEditor || input.newTabUrl ? (
				<div className="flex flex-wrap items-center justify-between gap-2">
					<fieldset aria-label="HTML view" className="flex gap-1">
						<Button
							aria-pressed={mode === "preview"}
							onClick={() => setMode("preview")}
							size="sm"
							variant={mode === "preview" ? "secondary" : "ghost"}
						>
							Preview
						</Button>
						{input.sourceEditor ? (
							<Button
								aria-pressed={mode === "source"}
								onClick={() => setMode("source")}
								size="sm"
								variant={mode === "source" ? "secondary" : "ghost"}
							>
								Source
							</Button>
						) : null}
					</fieldset>
					{input.hasUnsavedChanges ? (
						<span className="mr-auto text-muted-foreground text-xs">
							Unsaved changes
						</span>
					) : null}
					{preview && input.newTabUrl && !input.isError && !input.isLoading ? (
						<a
							className={buttonVariants({ size: "sm", variant: "outline" })}
							href={input.newTabUrl}
							rel="noopener noreferrer"
							target="_blank"
						>
							<ArrowSquareOutIcon aria-hidden="true" />
							{input.hasUnsavedChanges
								? "Open saved version in new tab"
								: "Open in new tab"}
						</a>
					) : null}
				</div>
			) : null}
			{mode === "source" ? (
				input.sourceEditor
			) : (
				<>
					<p className="text-muted-foreground text-xs">
						{SPACE_FILE_HTML_PREVIEW_NOTICE}
					</p>
					{renderPreview()}
				</>
			)}
		</div>
	);

	function renderPreview(): ReactNode {
		if (input.isError || error) {
			return (
				<div
					className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-md border px-6 text-center"
					role="alert"
				>
					<p className="text-sm">
						{input.isError ? "This file couldn’t be loaded. Try again." : error}
					</p>
					<Button
						onClick={input.isError ? input.onRetry : input.onDownload}
						size="sm"
						variant="outline"
					>
						{input.isError ? "Try again" : "Download file"}
					</Button>
				</div>
			);
		}
		if (input.isLoading || !preview) {
			return (
				<Skeleton
					aria-label="Loading HTML preview"
					className="min-h-80 flex-1 rounded-md"
				/>
			);
		}
		return (
			<iframe
				className="min-h-80 w-full flex-1 rounded-md border bg-white"
				referrerPolicy="no-referrer"
				sandbox=""
				srcDoc={preview}
				title={`HTML preview: ${input.fileName}`}
			/>
		);
	}
}

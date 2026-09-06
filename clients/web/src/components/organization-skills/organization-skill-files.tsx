"use client";

import type { OrganizationSkillFile } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { MarkdownEditor } from "#/components/editor/markdown-editor";

export function OrganizationSkillFiles(input: {
	canEdit: boolean;
	files: OrganizationSkillFile[];
	onChange: (files: OrganizationSkillFile[]) => void;
	saving: boolean;
}) {
	return (
		<section aria-labelledby="skill-files-heading" className="grid gap-3">
			<div>
				<h2 className="font-medium text-lg" id="skill-files-heading">
					Files
				</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					Markdown references can be edited. Scripts are stored for portability
					but are not executable in Phase 1.
				</p>
			</div>
			{input.files.length === 0 ? (
				<div className="rounded-md border p-4 text-muted-foreground text-sm">
					This Skill has no reference, asset, or script files.
				</div>
			) : (
				<div className="grid overflow-hidden rounded-md border">
					{input.files.map((file, index) => (
						<SkillFile
							canEdit={input.canEdit}
							file={file}
							key={file.path}
							onChange={(nextFile) => {
								const next = [...input.files];
								next[index] = nextFile;
								input.onChange(next);
							}}
							saving={input.saving}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function SkillFile(input: {
	canEdit: boolean;
	file: OrganizationSkillFile;
	onChange: (file: OrganizationSkillFile) => void;
	saving: boolean;
}) {
	const isMarkdownReference =
		input.file.encoding === "utf8" &&
		input.file.path.startsWith("references/") &&
		input.file.path.toLowerCase().endsWith(".md");
	const isScript = input.file.path.startsWith("scripts/");
	let fileContent: ReactNode;
	if (isMarkdownReference) {
		fileContent = (
			<MarkdownEditor
				disabled={!input.canEdit || input.saving}
				maxChars={256_000}
				onChange={(content) =>
					input.onChange({
						...input.file,
						content,
						size: new TextEncoder().encode(content).byteLength,
					})
				}
				value={input.file.content}
			/>
		);
	} else if (input.file.encoding === "utf8") {
		fileContent = (
			<ScrollArea className="max-h-96" orientation="both">
				<pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-xs">
					{input.file.content}
				</pre>
			</ScrollArea>
		);
	} else {
		fileContent = (
			<div className="flex items-center justify-between gap-3 rounded-md border p-4">
				<p className="text-muted-foreground text-sm">
					Binary file. Download it to inspect the original bytes.
				</p>
				<Button onClick={() => downloadSkillFile(input.file)} variant="outline">
					<DownloadSimpleIcon aria-hidden="true" /> Download
				</Button>
			</div>
		);
	}
	return (
		<details className="border-b p-4 last:border-b-0">
			<summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
				<span className="font-medium text-sm">{input.file.path}</span>
				<span className="flex items-center gap-2">
					{isScript ? <Badge variant="outline">Not executable</Badge> : null}
					<span className="text-muted-foreground text-xs">
						{formatBytes(input.file.size)} · {input.file.mediaType}
					</span>
				</span>
			</summary>
			<div className="mt-4">{fileContent}</div>
		</details>
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function downloadSkillFile(file: OrganizationSkillFile): void {
	const bytes =
		file.encoding === "base64"
			? Uint8Array.from(atob(file.content), (character) =>
					character.charCodeAt(0)
				)
			: new TextEncoder().encode(file.content);
	const blob = new Blob([bytes], { type: file.mediaType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = file.path.split("/").at(-1) ?? "skill-file";
	anchor.click();
	URL.revokeObjectURL(url);
}

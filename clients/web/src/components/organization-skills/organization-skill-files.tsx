"use client";

import type { OrganizationSkillFile } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	CaretDownIcon,
	DownloadSimpleIcon,
	PlusIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MarkdownEditor } from "#/components/editor/markdown-editor";
import { OrganizationSkillAddFileDialog } from "./organization-skill-add-file-dialog";
import { isEditableSkillReference } from "./organization-skill-validation";

export function OrganizationSkillFiles(input: {
	canEdit: boolean;
	contentGeneration: number;
	files: OrganizationSkillFile[];
	onAdd: (file: OrganizationSkillFile) => void;
	onChange: (file: OrganizationSkillFile) => void;
	onRemove: (path: string) => void;
	saving: boolean;
}) {
	const [expandedPath, setExpandedPath] = useState<string | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	return (
		<section aria-labelledby="skill-files-heading" className="grid gap-3">
			<h2 className="sr-only" id="skill-files-heading">
				Files
			</h2>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-muted-foreground text-sm">
					Supporting files are saved with the next Skill version.
				</p>
				{input.canEdit && (
					<Button
						disabled={input.saving}
						onClick={() => setAddOpen(true)}
						size="sm"
						variant="outline"
					>
						<PlusIcon aria-hidden="true" /> Add file
					</Button>
				)}
			</div>
			{input.files.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No supporting files yet.
				</p>
			)}
			<ul className="divide-y border-y">
				{input.files.map((file) => (
					<SkillFile
						canEdit={input.canEdit}
						contentGeneration={input.contentGeneration}
						expanded={expandedPath === file.path}
						file={file}
						key={file.path}
						onChange={input.onChange}
						onRemove={() => input.onRemove(file.path)}
						onToggle={() =>
							setExpandedPath(expandedPath === file.path ? null : file.path)
						}
						saving={input.saving}
					/>
				))}
			</ul>
			<OrganizationSkillAddFileDialog
				existingPaths={input.files.map((file) => file.path)}
				onAdd={input.onAdd}
				onOpenChange={setAddOpen}
				open={addOpen}
			/>
		</section>
	);
}

function SkillFile(input: {
	canEdit: boolean;
	contentGeneration: number;
	expanded: boolean;
	file: OrganizationSkillFile;
	onChange: (file: OrganizationSkillFile) => void;
	onRemove: () => void;
	onToggle: () => void;
	saving: boolean;
}) {
	const id = useId();
	// Mount on first opening, then retain the visited editor until Skill identity
	// changes. Switching files must not lose queued input or its Undo history.
	const [visited, setVisited] = useState(false);
	useEffect(() => {
		if (input.expanded) {
			setVisited(true);
		}
	}, [input.expanded]);
	return (
		<li>
			<button
				aria-controls={input.expanded ? id : undefined}
				aria-expanded={input.expanded}
				className="flex min-h-14 w-full flex-wrap items-center justify-between gap-2 px-1 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={input.onToggle}
				type="button"
			>
				<span className="flex min-w-0 flex-1 items-center gap-2 font-medium text-sm">
					<CaretDownIcon
						aria-hidden="true"
						className={`size-4 shrink-0 text-muted-foreground ${input.expanded ? "" : "-rotate-90"}`}
					/>
					<span className="break-all">{input.file.path}</span>
				</span>
				<span className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
					{input.file.path.startsWith("scripts/") && (
						<Badge variant="outline">Not executable</Badge>
					)}
					<span>
						{formatBytes(input.file.size)} · {input.file.mediaType}
					</span>
				</span>
			</button>
			{(input.expanded || visited) && (
				<div className="min-w-0 pb-4" hidden={!input.expanded} id={id}>
					{input.canEdit && (
						<div className="flex justify-end pb-2">
							<Button
								disabled={input.saving}
								onClick={input.onRemove}
								size="sm"
								variant="ghost"
							>
								<TrashIcon aria-hidden="true" /> Remove file
							</Button>
						</div>
					)}
					<SkillFileContent
						canEdit={input.canEdit}
						file={input.file}
						key={input.contentGeneration}
						onChange={input.onChange}
						saving={input.saving}
					/>
				</div>
			)}
		</li>
	);
}

function SkillFileContent(input: {
	canEdit: boolean;
	file: OrganizationSkillFile;
	onChange: (file: OrganizationSkillFile) => void;
	saving: boolean;
}) {
	// Removed files and superseded content generations cannot deliver stale input.
	const mounted = useRef(false);
	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	if (isEditableSkillReference(input.file)) {
		return (
			<MarkdownEditor
				ariaLabel={input.file.path}
				disabled={!input.canEdit || input.saving}
				maxChars={256_000}
				onChange={(content) => {
					if (mounted.current) {
						input.onChange({
							...input.file,
							content,
							size: new TextEncoder().encode(content).byteLength,
						});
					}
				}}
				presentation="page"
				value={input.file.content}
			/>
		);
	}
	if (input.file.encoding === "utf8") {
		return (
			<ScrollArea className="max-h-96" orientation="both">
				<pre className="whitespace-pre-wrap bg-muted/30 p-4 text-sm">
					{input.file.content}
				</pre>
			</ScrollArea>
		);
	}
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 py-3">
			<p className="text-muted-foreground text-sm">
				Download this file to view it.
			</p>
			<Button onClick={() => downloadSkillFile(input.file)} variant="outline">
				<DownloadSimpleIcon aria-hidden="true" /> Download
			</Button>
		</div>
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

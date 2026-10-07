import type { OrganizationSkillGitHubRepositoryPreview } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import type { Dispatch, ReactNode, SetStateAction } from "react";

export type RepositoryBatchResult = {
	error?: string;
	status: "installed" | "failed";
};

export function OrganizationSkillRepositoryCatalog(input: {
	batchInstalling: boolean;
	existingPaths: Set<string>;
	preview: OrganizationSkillGitHubRepositoryPreview;
	results: Map<string, RepositoryBatchResult>;
	reviewing: boolean;
	onReview: (url: string) => void;
	selectedUrls: Set<string>;
	setSelectedUrls: Dispatch<SetStateAction<Set<string>>>;
}) {
	const installedCount = [...input.results.values()].filter(
		(result) => result.status === "installed"
	).length;
	const disabled = input.reviewing || input.batchInstalling;
	return (
		<div className="grid gap-2">
			<p className="text-muted-foreground text-sm">
				{input.preview.skills.length} skills found at commit{" "}
				{input.preview.commitSha.slice(0, 12)}.
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					disabled={disabled}
					onClick={() =>
						input.setSelectedUrls(
							new Set(
								input.preview.skills
									.filter((skill) => !skill.blocker)
									.filter((skill) => !input.existingPaths.has(skill.path))
									.map((skill) => skill.url)
							)
						)
					}
					size="sm"
					variant="ghost"
				>
					Select available
				</Button>
				<Button
					disabled={disabled}
					onClick={() => input.setSelectedUrls(new Set())}
					size="sm"
					variant="ghost"
				>
					Clear selection
				</Button>
				{input.results.size > 0 && (
					<output className="text-muted-foreground text-sm">
						{installedCount} installed · {input.results.size - installedCount}{" "}
						failed
					</output>
				)}
			</div>
			<ScrollArea className="max-h-72" contentClassName="grid">
				{input.preview.skills.map((skill) => {
					const selected = input.selectedUrls.has(skill.url);
					const result = input.results.get(skill.url);
					const existing = input.existingPaths.has(skill.path);
					let selectionControl: ReactNode;
					if (result?.status === "installed") {
						selectionControl = (
							<span className="text-muted-foreground text-sm">Installed</span>
						);
					} else if (existing) {
						selectionControl = (
							<span className="text-muted-foreground text-sm">
								Already in Team
							</span>
						);
					} else {
						selectionControl = (
							<Button
								aria-pressed={selected}
								disabled={disabled || Boolean(skill.blocker)}
								onClick={() =>
									input.setSelectedUrls((previous) => {
										const next = new Set(previous);
										if (next.has(skill.url)) {
											next.delete(skill.url);
										} else {
											next.add(skill.url);
										}
										return next;
									})
								}
								size="sm"
								variant={selected ? "secondary" : "outline"}
							>
								{selected ? "Selected" : "Select"}
							</Button>
						);
					}
					return (
						<div
							className="flex min-w-0 flex-wrap items-center gap-2 border-b py-2 last:border-b-0"
							key={skill.url}
						>
							<div className="grid min-w-0 flex-1 gap-1">
								<span className="truncate text-sm">
									{skill.path || "Repository root"}
								</span>
								<span className="text-muted-foreground text-xs">
									{result?.error ??
										skill.blocker?.message ??
										`${skill.fileCount} ${skill.fileCount === 1 ? "file" : "files"} · ${skill.totalBytes.toLocaleString()} bytes`}
								</span>
							</div>
							{selectionControl}
							<Button
								disabled={disabled || Boolean(skill.blocker)}
								onClick={() => input.onReview(skill.url)}
								size="sm"
								variant="outline"
							>
								Review
							</Button>
						</div>
					);
				})}
			</ScrollArea>
		</div>
	);
}

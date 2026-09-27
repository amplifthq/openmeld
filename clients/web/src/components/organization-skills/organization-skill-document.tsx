import { ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS } from "@openmeld/schemas";
import type {
	OrganizationSkill,
	OrganizationSkillBundle,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { useRouterState } from "@tanstack/react-router";
import { type SetStateAction, useEffect, useId, useState } from "react";
import { MarkdownEditor } from "#/components/editor/markdown-editor";
import { OrganizationSkillDocumentTitle } from "./organization-skill-document-title";
import { OrganizationSkillFiles } from "./organization-skill-files";

/** View state is local; every editable surface writes into the owner's single draft. */
export function OrganizationSkillDocument(input: {
	bundle: OrganizationSkillBundle;
	skill: OrganizationSkill;
	contentGeneration: number;
	saving: boolean;
	onChange: (update: SetStateAction<OrganizationSkillBundle>) => void;
}) {
	const [view, setView] = useState(0);
	const hash = useRouterState({ select: (state) => state.location.hash });
	useEffect(() => {
		if (hash === "skill-files-heading") {
			setView(1);
		} else if (hash === "skill-instructions-heading") {
			setView(0);
		}
	}, [hash]);
	const tabsId = useId();
	const hasFiles = input.bundle.files.length > 0;
	const showFilesTab = hasFiles || input.skill.permissions.canEdit;
	const showFiles = showFilesTab && view === 1;
	return (
		<>
			<OrganizationSkillDocumentTitle
				bundle={input.bundle}
				canEdit={input.skill.permissions.canEdit}
				disabled={input.saving}
				onChange={input.onChange}
			/>
			<div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
				<Badge variant={input.skill.enabled ? "secondary" : "outline"}>
					{input.skill.enabled ? "Enabled" : "Disabled"}
				</Badge>
				<span>
					{input.skill.source.kind === "github"
						? "Imported from GitHub"
						: "Created in OpenMeld"}
				</span>
			</div>
			{showFilesTab && (
				<TabsSubtle
					aria-label="Skill content"
					className="gap-5 border-b"
					idPrefix={tabsId}
					onSelect={setView}
					selectedIndex={showFiles ? 1 : 0}
					variant="underline"
				>
					<TabsSubtleItem
						index={0}
						label="Instructions"
						labelClassName="text-sm"
					/>
					<TabsSubtleItem
						index={1}
						label={`Files (${input.bundle.files.length})`}
						labelClassName="text-sm"
					/>
				</TabsSubtle>
			)}
			<section
				aria-labelledby={
					showFilesTab ? `${tabsId}-tab-0` : "skill-instructions-heading"
				}
				hidden={showFiles}
				id={`${tabsId}-panel-0`}
				role={showFilesTab ? "tabpanel" : undefined}
			>
				<h2
					className={showFilesTab ? "sr-only" : "mb-2 font-medium text-sm"}
					id="skill-instructions-heading"
				>
					Instructions
				</h2>
				<MarkdownEditor
					ariaLabel="Instructions"
					disabled={!input.skill.permissions.canEdit || input.saving}
					key={input.contentGeneration}
					maxChars={ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS}
					onChange={(instructions) =>
						input.onChange((current) => ({ ...current, instructions }))
					}
					placeholder="Describe when to use this skill, what to do, and the expected result."
					presentation="page"
					value={input.bundle.instructions}
				/>
			</section>
			{showFilesTab && (
				<div
					aria-labelledby={`${tabsId}-tab-1`}
					hidden={!showFiles}
					id={`${tabsId}-panel-1`}
					role="tabpanel"
				>
					<OrganizationSkillFiles
						canEdit={input.skill.permissions.canEdit}
						contentGeneration={input.contentGeneration}
						files={input.bundle.files}
						onAdd={(file) =>
							input.onChange((current) => ({
								...current,
								files: [...current.files, file],
							}))
						}
						onChange={(file) =>
							input.onChange((current) => ({
								...current,
								files: current.files.map((existing) =>
									existing.path === file.path
										? { ...existing, content: file.content, size: file.size }
										: existing
								),
							}))
						}
						onRemove={(path) =>
							input.onChange((current) => ({
								...current,
								files: current.files.filter((file) => file.path !== path),
							}))
						}
						saving={input.saving}
					/>
				</div>
			)}
		</>
	);
}

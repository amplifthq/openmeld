import type {
	OrganizationSkill,
	OrganizationSkillBundle,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import type { RefObject, SetStateAction } from "react";
import type { SaveBeforeLeaveResult } from "#/components/forms/unsaved-changes-guard";
import { OrganizationSkillPortableFields } from "./organization-skill-portable-fields";
import { OrganizationSkillSourceHistory } from "./organization-skill-source-history";

export type SkillContextView = "properties" | "history" | "usage";
const CONTEXT_TITLES = {
	properties: "Properties",
	history: "Version history",
	usage: "How agents use this skill",
};
const CONTEXT_DESCRIPTIONS = {
	properties:
		"Optional settings stored with this skill. Closing keeps your unsaved changes.",
	history:
		"Saved versions of this skill. Work in progress keeps its original version.",
	usage: "Use the saved skill in a conversation or load it through OpenMeld.",
};

export function OrganizationSkillContextDialog(input: {
	view: SkillContextView | null;
	onClose: () => void;
	finalFocus: RefObject<HTMLButtonElement | null>;
	bundle: OrganizationSkillBundle;
	skill: OrganizationSkill;
	organizationName: string;
	canEdit: boolean;
	hasUnsavedChanges: boolean;
	valid: boolean;
	saving: boolean;
	errorMessage: string | null;
	onChange: (update: SetStateAction<OrganizationSkillBundle>) => void;
	onSave: () => Promise<SaveBeforeLeaveResult>;
}) {
	const view = input.view ?? "properties";
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || input.saving)) {
					input.onClose();
				}
			}}
			open={input.view !== null}
		>
			<DialogContent
				className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
				finalFocus={input.finalFocus}
				showCloseButton={!input.saving}
				size="lg"
			>
				<DialogHeader>
					<DialogTitle>{CONTEXT_TITLES[view]}</DialogTitle>
					<DialogDescription>{CONTEXT_DESCRIPTIONS[view]}</DialogDescription>
				</DialogHeader>
				<ScrollArea className="min-h-0 flex-1" contentClassName="px-1 py-1">
					{view === "properties" && (
						<OrganizationSkillPortableFields
							bundle={input.bundle}
							disabled={input.saving}
							onChange={input.onChange}
							readOnly={!input.canEdit}
						/>
					)}
					{view === "history" && (
						<OrganizationSkillSourceHistory skill={input.skill} />
					)}
					{view === "usage" && (
						<div className="grid gap-5 text-sm leading-relaxed">
							{!input.skill.enabled && (
								<p className="rounded-md bg-muted p-3">
									This skill is disabled. A workspace admin must enable it
									before agents can load it.
								</p>
							)}
							<section className="grid gap-2">
								<h3 className="font-medium">In a conversation</h3>
								<p>
									Ask your agent to use <strong>{input.skill.name}</strong> for
									a relevant task. Center Agent and personal remote agents can
									discover enabled skills in this workspace.
								</p>
							</section>
							<section className="grid gap-2">
								<h3 className="font-medium">With a local agent</h3>
								<p>
									Sign in to OpenMeld and select {input.organizationName} first.
									Then use:
								</p>
								<pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
									<code>{`openmeld skills list\nopenmeld skills show ${input.skill.id}${input.skill.enabled ? `\nopenmeld skills load ${input.skill.id}` : ""}`}</code>
								</pre>
							</section>
							<p className="text-muted-foreground">
								Enabled means available, not already loaded. Sharing a link does
								not run a skill or grant tools or permissions.
							</p>
						</div>
					)}
				</ScrollArea>
				{view === "properties" && input.errorMessage && (
					<p className="text-destructive text-sm" role="alert">
						{input.errorMessage}
					</p>
				)}
				<DialogFooter>
					<Button
						disabled={input.saving}
						onClick={input.onClose}
						variant="outline"
					>
						Close
					</Button>
					{view === "properties" && input.canEdit && (
						<Button
							disabled={
								!(input.hasUnsavedChanges && input.valid) || input.saving
							}
							onClick={input.onSave}
						>
							{input.saving ? "Saving…" : "Save skill"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

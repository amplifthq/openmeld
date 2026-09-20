import { ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS } from "@openmeld/schemas";
import type { OrganizationSkill } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { DialogClose, DialogFooter } from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Textarea } from "@openmeld/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { type RefObject, useRef, useState } from "react";
import { MarkdownEditor } from "#/components/editor/markdown-editor";
import {
	createCurrentOrganizationSkill,
	resolveOrganizationSkillErrorMessage,
} from "#/lib/organizations/organization-skills";
import { OrganizationSkillFlowDialog } from "./organization-skill-flow-dialog";
import { SKILL_NAME_PATTERN } from "./organization-skill-validation";

export function CreateSkillDialog(input: {
	organizationId: string;
	isPersonalWorkspace: boolean;
	finalFocus: RefObject<HTMLButtonElement | null>;
	onClose: () => void;
	onCreated: (skill: OrganizationSkill) => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [instructions, setInstructions] = useState("");
	const submitting = useRef(false);
	const create = useMutation({
		mutationFn: (body: Parameters<typeof createCurrentOrganizationSkill>[0]) =>
			createCurrentOrganizationSkill(body),
		onSuccess: (response) => input.onCreated(response.skill),
	});
	const valid =
		SKILL_NAME_PATTERN.test(name.trim()) &&
		description.trim().length > 0 &&
		instructions.length <= ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS;
	const submit = async () => {
		if (!valid || submitting.current) {
			return;
		}
		submitting.current = true;
		try {
			await create.mutateAsync({
				name,
				description,
				instructions,
				expectedOrganizationId: input.organizationId,
			});
		} catch {
			// The same dialog retains input and displays the mutation's real error.
		} finally {
			submitting.current = false;
		}
	};
	return (
		<OrganizationSkillFlowDialog
			committing={create.isPending}
			description={
				input.isPersonalWorkspace
					? "Add a working method for your agents."
					: "Add a working method for agents in this workspace."
			}
			dirty={Boolean(name || description || instructions.trim())}
			discardDescription="Your new skill hasn't been created. Discarding will remove what you've written."
			discardTitle="Discard this new skill?"
			finalFocus={input.finalFocus}
			footer={
				<DialogFooter>
					<DialogClose
						disabled={create.isPending}
						render={<Button variant="outline" />}
					>
						Cancel
					</DialogClose>
					<Button disabled={!valid || create.isPending} onClick={submit}>
						{create.isPending ? "Creating…" : "Create skill"}
					</Button>
				</DialogFooter>
			}
			onClose={input.onClose}
			size="xl"
			title="Create skill"
		>
			<div className="grid min-w-0 gap-5">
				<div className="grid gap-2">
					<Label htmlFor="new-skill-name">Name</Label>
					<Input
						aria-describedby="new-skill-name-help"
						autoCapitalize="none"
						autoCorrect="off"
						disabled={create.isPending}
						id="new-skill-name"
						maxLength={64}
						onChange={(event) => setName(event.target.value)}
						placeholder="weekly-customer-review"
						value={name}
					/>
					<p className="text-muted-foreground text-xs" id="new-skill-name-help">
						Use lowercase letters, numbers, and single hyphens.
					</p>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="new-skill-description">Description</Label>
					<Textarea
						className="min-h-16"
						disabled={create.isPending}
						id="new-skill-description"
						maxLength={1024}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="Review customer feedback and summarize the week's risks."
						rows={2}
						value={description}
					/>
				</div>
				<section aria-label="Skill instructions" className="min-w-0">
					<h3 className="mb-2 font-medium text-sm">Instructions</h3>
					<MarkdownEditor
						ariaLabel="Instructions"
						disabled={create.isPending}
						maxChars={ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS}
						onChange={setInstructions}
						placeholder="Describe when to use this skill, the steps to follow, and the expected result."
						presentation="page"
						value={instructions}
					/>
				</section>
				{create.isError && (
					<p className="text-destructive text-sm" role="alert">
						{resolveOrganizationSkillErrorMessage(create.error)}
					</p>
				)}
			</div>
		</OrganizationSkillFlowDialog>
	);
}

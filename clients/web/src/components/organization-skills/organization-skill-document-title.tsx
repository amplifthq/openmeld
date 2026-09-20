import type { OrganizationSkillBundle } from "@openmeld/schemas/types";
import { Textarea } from "@openmeld/ui/components/textarea";
import type { SetStateAction } from "react";
import { SKILL_NAME_PATTERN } from "./organization-skill-validation";

export function OrganizationSkillDocumentTitle(input: {
	bundle: OrganizationSkillBundle;
	canEdit: boolean;
	disabled: boolean;
	onChange: (update: SetStateAction<OrganizationSkillBundle>) => void;
}) {
	const { name, description } = input.bundle.portable;
	if (!input.canEdit) {
		return (
			<header className="grid gap-3">
				<h1 className="break-words font-semibold text-3xl leading-tight">
					{name}
				</h1>
				<p className="whitespace-pre-wrap break-words text-base text-muted-foreground">
					{description}
				</p>
			</header>
		);
	}
	const invalidName = !SKILL_NAME_PATTERN.test(name.trim());
	return (
		<header className="grid gap-2">
			<div className="group/name">
				<h1 aria-label={name || "Skill name"}>
					<Textarea
						aria-describedby="skill-name-help"
						aria-invalid={invalidName}
						aria-label="Name"
						className="field-sizing-content min-h-12 resize-none border-transparent bg-transparent px-0 py-1 font-semibold text-3xl leading-tight shadow-none focus-visible:px-2"
						disabled={input.disabled}
						maxLength={64}
						onChange={(event) =>
							input.onChange((current) => ({
								...current,
								portable: { ...current.portable, name: event.target.value },
							}))
						}
						placeholder="skill-name"
						rows={1}
						value={name}
					/>
				</h1>
				<p
					className={
						invalidName
							? "text-destructive text-xs"
							: "hidden text-muted-foreground text-xs group-focus-within/name:block"
					}
					id="skill-name-help"
				>
					Use lowercase letters, numbers, and single hyphens.
				</p>
			</div>
			<Textarea
				aria-invalid={!description.trim()}
				aria-label="Description"
				className="field-sizing-content min-h-10 resize-none border-transparent bg-transparent px-0 py-1 text-base text-muted-foreground shadow-none focus-visible:px-2"
				disabled={input.disabled}
				maxLength={1024}
				onChange={(event) =>
					input.onChange((current) => ({
						...current,
						portable: { ...current.portable, description: event.target.value },
					}))
				}
				placeholder="Describe when this skill is useful."
				rows={1}
				value={description}
			/>
			{!description.trim() && (
				<p className="text-destructive text-xs">
					Add a short description before saving.
				</p>
			)}
		</header>
	);
}

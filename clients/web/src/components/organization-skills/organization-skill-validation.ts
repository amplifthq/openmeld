import { ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS } from "@openmeld/schemas";
import type {
	OrganizationSkillBundle,
	OrganizationSkillFile,
} from "@openmeld/schemas/types";

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isEditableSkillReference(file: OrganizationSkillFile): boolean {
	return (
		file.encoding === "utf8" &&
		file.path.startsWith("references/") &&
		file.path.toLowerCase().endsWith(".md")
	);
}

export function skillDraftValidationMessage(
	bundle: OrganizationSkillBundle
): string | null {
	if (!SKILL_NAME_PATTERN.test(bundle.portable.name.trim())) {
		return "Use lowercase letters, numbers, and single hyphens for the name.";
	}
	if (!bundle.portable.description.trim()) {
		return "Add a short description before saving.";
	}
	if (Object.keys(bundle.portable.metadata).some((key) => !key.trim())) {
		return "Give every metadata field a name in Properties.";
	}
	if (bundle.instructions.length > ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS) {
		return "Shorten the instructions before saving.";
	}
	const tooLong = bundle.files.find(
		(file) => isEditableSkillReference(file) && file.content.length > 256_000
	);
	return tooLong ? `Shorten ${tooLong.path} before saving.` : null;
}

export function skillSaveStatus(input: {
	dirty: boolean;
	failed: boolean;
	saving: boolean;
}): string {
	if (input.saving) {
		return "Saving…";
	}
	if (input.failed) {
		return "Couldn't save";
	}
	return input.dirty ? "Unsaved changes" : "Saved";
}

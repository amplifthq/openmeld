import {
	createOrganizationSkillsApi,
	type OrganizationSkillRequestInput,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE } from "@openmeld/schemas";
import type {
	CreateOrganizationSkillBody,
	CreateOrganizationSkillResponse,
	DeleteOrganizationSkillBody,
	DeleteOrganizationSkillResponse,
	GetOrganizationSkillResponse,
	ImportOrganizationSkillFromGitHubBody,
	ImportOrganizationSkillFromGitHubResponse,
	ListOrganizationSkillsResponse,
	PreviewOrganizationSkillFromGitHubBody,
	PreviewOrganizationSkillFromGitHubResponse,
	SetOrganizationSkillEnabledBody,
	SetOrganizationSkillEnabledResponse,
	SetOrganizationSkillMaintainersBody,
	SetOrganizationSkillMaintainersResponse,
	UpdateOrganizationSkillBody,
	UpdateOrganizationSkillResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type OrganizationSkillFailure = StructuredApiClientFailure;

function createWebOrganizationSkillsApi(organizationId: string) {
	return createOrganizationSkillsApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function listCurrentOrganizationSkills(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ListOrganizationSkillsResponse> {
	try {
		const response = await createWebOrganizationSkillsApi(
			input.organizationId
		).list({ signal: input.signal });
		assertOrganizationId(response.organizationId, input.organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function getCurrentOrganizationSkill(
	input: OrganizationSkillRequestInput & {
		organizationId: string;
		skillId: string;
	}
): Promise<GetOrganizationSkillResponse> {
	try {
		const response = await createWebOrganizationSkillsApi(
			input.organizationId
		).get(input);
		assertOrganizationId(response.skill.organizationId, input.organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function createCurrentOrganizationSkill(
	input: OrganizationSkillRequestInput & CreateOrganizationSkillBody
): Promise<CreateOrganizationSkillResponse> {
	const response = await runMutation(input.expectedOrganizationId, (api) =>
		api.create(input)
	);
	assertOrganizationId(
		response.skill.organizationId,
		input.expectedOrganizationId
	);
	return response;
}

export async function importCurrentOrganizationSkillFromGitHub(
	input: OrganizationSkillRequestInput & ImportOrganizationSkillFromGitHubBody
): Promise<ImportOrganizationSkillFromGitHubResponse> {
	const response = await runMutation(input.expectedOrganizationId, (api) =>
		api.importFromGitHub(input)
	);
	assertOrganizationId(
		response.skill.organizationId,
		input.expectedOrganizationId
	);
	return response;
}

export async function previewCurrentOrganizationSkillFromGitHub(
	input: OrganizationSkillRequestInput & PreviewOrganizationSkillFromGitHubBody
): Promise<PreviewOrganizationSkillFromGitHubResponse> {
	const response = await runMutation(input.expectedOrganizationId, (api) =>
		api.previewFromGitHub(input)
	);
	assertOrganizationId(response.organizationId, input.expectedOrganizationId);
	return response;
}

export async function updateCurrentOrganizationSkill(
	input: OrganizationSkillRequestInput &
		UpdateOrganizationSkillBody & { skillId: string }
): Promise<UpdateOrganizationSkillResponse> {
	const response = await runMutation(input.expectedOrganizationId, (api) =>
		api.update(input)
	);
	assertOrganizationId(
		response.skill.organizationId,
		input.expectedOrganizationId
	);
	return response;
}

export async function setCurrentOrganizationSkillEnabled(
	input: OrganizationSkillRequestInput &
		SetOrganizationSkillEnabledBody & { skillId: string }
): Promise<SetOrganizationSkillEnabledResponse> {
	const response = await runMutation(input.expectedOrganizationId, (api) =>
		api.setEnabled(input)
	);
	assertOrganizationId(
		response.skill.organizationId,
		input.expectedOrganizationId
	);
	return response;
}

export async function setCurrentOrganizationSkillMaintainers(
	input: OrganizationSkillRequestInput &
		SetOrganizationSkillMaintainersBody & { skillId: string }
): Promise<SetOrganizationSkillMaintainersResponse> {
	const response = await runMutation(input.expectedOrganizationId, (api) =>
		api.setMaintainers(input)
	);
	assertOrganizationId(
		response.skill.organizationId,
		input.expectedOrganizationId
	);
	return response;
}

export async function deleteCurrentOrganizationSkill(
	input: OrganizationSkillRequestInput &
		DeleteOrganizationSkillBody & { skillId: string }
): Promise<DeleteOrganizationSkillResponse> {
	const response = await runMutation(input.expectedOrganizationId, (api) =>
		api.delete(input)
	);
	assertOrganizationId(response.organizationId, input.expectedOrganizationId);
	return response;
}

async function runMutation<T>(
	organizationId: string,
	operation: (
		api: ReturnType<typeof createWebOrganizationSkillsApi>
	) => Promise<T>
): Promise<T> {
	try {
		return await operation(createWebOrganizationSkillsApi(organizationId));
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

function assertOrganizationId(actual: string, expected: string): void {
	if (actual !== expected) {
		throw new Error("Organization Skill response organization mismatch.");
	}
}

export function resolveOrganizationSkillErrorMessage(error: unknown): string {
	const failure = toStructuredApiClientFailure(error);
	switch (failure.upstreamCode ?? failure.code) {
		case "organization_skill.edit_forbidden":
		case "organization_skill.manage_forbidden":
			return "You do not have permission to make this change.";
		case "organization_skill.name_exists":
			return "This Organization already has a Skill with that name.";
		case "organization_skill.not_found":
			return "This Skill no longer exists.";
		case "organization_skill.organization_context_changed":
			return ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE;
		case "organization_skill.version_conflict":
			return "This Skill changed after you opened it. Reload the latest version before saving.";
		case "organization_skill.github_selection_required":
			return "This GitHub URL contains more than one Skill. Link directly to one Skill folder.";
		case "organization_skill.github_source_changed":
			return "This GitHub source changed after you reviewed it. Review the latest version before installing.";
		case "organization_skill.github_url_invalid":
			return "Enter a valid GitHub repository, folder, or SKILL.md URL.";
		case "organization_skill.github_unavailable":
			return "GitHub could not provide this Skill right now. Try again.";
		case "organization_skill.github_response_invalid":
		case "organization_skill.invalid_bundle":
		case "organization_skill.skill_markdown_invalid":
		case "organization_skill.skill_markdown_missing":
		case "organization_skill.unsafe_bundle":
			return "This source is not a valid portable Agent Skill.";
		case "organization_skill.bundle_too_large":
		case "organization_skill.file_limit_reached":
		case "organization_skill.github_tree_too_large":
			return "This Skill is larger than OpenMeld's Phase 1 limits.";
		case "organization_skill.maintainer_not_member":
			return "Every Skill Maintainer must be a current Organization member.";
		default:
			return "OpenMeld couldn't save this Skill. Try again.";
	}
}

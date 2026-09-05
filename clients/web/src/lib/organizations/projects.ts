import {
	type CreateProjectInput,
	createProjectsApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
	type UpdateProjectInput,
} from "@openmeld/api-client";
import { ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE } from "@openmeld/schemas";
import type {
	ArchiveProjectResponse,
	CreateProjectResponse,
	ListProjectsResponse,
	UpdateProjectResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type ProjectFailure = StructuredApiClientFailure;

function createWebProjectsApi(organizationId: string) {
	return createProjectsApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function listCurrentProjects(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ListProjectsResponse> {
	try {
		const response = await createWebProjectsApi(input.organizationId).list({
			signal: input.signal,
		});
		if (response.organizationId !== input.organizationId) {
			throw new Error("Project response organization mismatch.");
		}
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function createCurrentProject(
	input: CreateProjectInput
): Promise<CreateProjectResponse> {
	try {
		return await createWebProjectsApi(input.expectedOrganizationId).create(
			input
		);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateCurrentProject(
	input: UpdateProjectInput
): Promise<UpdateProjectResponse> {
	try {
		return await createWebProjectsApi(input.expectedOrganizationId).update(
			input
		);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function archiveCurrentProject(input: {
	expectedOrganizationId: string;
	projectId: string;
}): Promise<ArchiveProjectResponse> {
	try {
		return await createWebProjectsApi(input.expectedOrganizationId).archive(
			input
		);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function resolveProjectErrorMessage(
	error: unknown,
	action: "archive" | "create" | "list" | "update",
	input: { explicitSlug?: boolean } = {}
): string {
	const failure = toStructuredApiClientFailure(error);
	const code = failure.upstreamCode ?? failure.code;
	switch (code) {
		case "project.repository_exists":
			return "This repository already has a project. Try again to choose the existing project.";
		case "project.operation_conflict":
			return "This creation request has changed. Close this dialog and try again.";
		case "project.forbidden":
			return "You do not have permission to manage this Project.";
		case "project.has_activity":
			return "This Project already has Activity. Only the organization owner can remove it.";
		case "project.slug_conflict":
			return input.explicitSlug
				? "That CLI slug is already in use in this workspace."
				: "OpenMeld couldn’t choose an available CLI slug. Open Advanced and enter a different one.";
		case "project.limit_reached":
			return "This workspace already has 500 active Projects. Remove an unused Project before adding another.";
		case "project.not_found":
			return "This Project no longer exists. Refresh the page to see the latest Projects.";
		case "project.archived":
			return "This Project is archived and can no longer be changed.";
		case "project.conflict":
			return "This Project changed in another session. Refresh and try again.";
		case "project.organization_context_changed":
			return ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE;
		default:
			return action === "list"
				? "OpenMeld could not load Projects. Try again."
				: `OpenMeld could not ${action} this Project. Try again.`;
	}
}

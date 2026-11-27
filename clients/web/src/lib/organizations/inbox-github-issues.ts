import { inboxGitHubIssuesResponseSchema } from "@openmeld/schemas";
import type {
	InboxGitHubIssuesQuery,
	InboxGitHubIssuesResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function listCurrentGitHubInboxIssues(
	input: InboxGitHubIssuesQuery & {
		organizationId: string;
		signal?: AbortSignal;
	}
): Promise<InboxGitHubIssuesResponse> {
	const { organizationId, repository, state, assignee, signal } = input;
	const query = new URLSearchParams();
	if (repository) {
		query.set("repository", repository);
	}
	if (state) {
		query.set("state", state);
	}
	if (assignee) {
		query.set("assignee", assignee);
	}
	const result = await createOrganizationScopedWebOpenMeldApiFoundation({
		organizationId,
	}).requestJson({
		invalidMessage: "Invalid GitHub issues response",
		method: "GET",
		operation: "inbox.github_issues",
		schema: inboxGitHubIssuesResponseSchema,
		signal,
		url: `/v1/inbox/github-issues?${query}`,
	});
	if (result.organizationId !== organizationId) {
		throw new Error("GitHub issues response organization mismatch.");
	}
	return result;
}

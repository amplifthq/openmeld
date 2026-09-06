import {
	centerAgentSessionSelectorSchema,
	slackOAuthErrorCodeSchema,
} from "@openmeld/schemas";
import { z } from "zod/v4";
import type { SlackOAuthResult } from "./slack-oauth-result";

export const centerAgentRouteSearchSchema = z.object({
	session: centerAgentSessionSelectorSchema.shape.spaceId.optional(),
	focusSignalId: z.string().trim().min(1).max(256).optional(),
	view: z.enum(["messages", "graph", "files"]).optional(),
	slack_oauth: z.enum(["connected", "error", "move_required"]).optional(),
	slack_oauth_error: slackOAuthErrorCodeSchema.optional(),
	slack_oauth_from_organization_id: z
		.string()
		.trim()
		.min(1)
		.max(256)
		.optional(),
	slack_oauth_from_organization_name: z
		.string()
		.trim()
		.min(1)
		.max(256)
		.optional(),
});

export type CenterAgentRouteSearch = z.infer<
	typeof centerAgentRouteSearchSchema
>;

export function parseCenterAgentRouteSearch(
	search: unknown
): CenterAgentRouteSearch {
	const parsed = centerAgentRouteSearchSchema.safeParse(search);
	if (parsed.success) {
		return parsed.data;
	}
	if (
		typeof search === "object" &&
		search !== null &&
		"session" in search &&
		search.session !== undefined
	) {
		const selector = centerAgentSessionSelectorSchema.safeParse({
			spaceId: search.session,
		});
		if (!selector.success) {
			throw new Error("The chat link has an invalid session ID.");
		}
		return { session: selector.data.spaceId };
	}
	return {};
}

export function resolveSlackOAuthResult(
	search: CenterAgentRouteSearch
): SlackOAuthResult | undefined {
	if (search.slack_oauth === "connected") {
		return { status: "connected" };
	}
	if (search.slack_oauth === "error" && search.slack_oauth_error) {
		return { error: search.slack_oauth_error, status: "error" };
	}
	if (
		search.slack_oauth === "move_required" &&
		search.slack_oauth_from_organization_id &&
		search.slack_oauth_from_organization_name
	) {
		return {
			fromOrganizationId: search.slack_oauth_from_organization_id,
			fromOrganizationName: search.slack_oauth_from_organization_name,
			status: "move_required",
		};
	}
	return undefined;
}

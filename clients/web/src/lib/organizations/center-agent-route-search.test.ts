import { describe, expect, it } from "vitest";
import {
	parseCenterAgentRouteSearch,
	resolveSlackOAuthResult,
} from "./center-agent-route-search";

describe("Center Agent route search", () => {
	it("drops the retired manage view", () => {
		const search = parseCenterAgentRouteSearch({ view: "manage" });
		expect(search).toEqual({});
	});

	it("keeps the informed Slack workspace move context", () => {
		expect(
			parseCenterAgentRouteSearch({
				slack_oauth: "move_required",
				slack_oauth_from_organization_id: " org-previous ",
				slack_oauth_from_organization_name: " Previous Org ",
			})
		).toEqual({
			slack_oauth: "move_required",
			slack_oauth_from_organization_id: "org-previous",
			slack_oauth_from_organization_name: "Previous Org",
		});
	});

	it("resolves the Slack result passed to Center Agent Channels", () => {
		expect(
			resolveSlackOAuthResult(
				parseCenterAgentRouteSearch({
					slack_oauth: "move_required",
					slack_oauth_from_organization_id: "org-previous",
					slack_oauth_from_organization_name: "Previous Org",
				})
			)
		).toEqual({
			fromOrganizationId: "org-previous",
			fromOrganizationName: "Previous Org",
			status: "move_required",
		});
	});

	it("drops invalid route search without changing the public URL contract", () => {
		expect(
			parseCenterAgentRouteSearch({
				slack_oauth: "unknown",
				view: "chat",
			})
		).toEqual({});
	});
});

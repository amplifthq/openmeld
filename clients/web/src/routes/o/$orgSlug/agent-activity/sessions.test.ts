import { describe, expect, it } from "vitest";
import { agentActivityProjectScopeParser } from "#/lib/organizations/agent-activity-search";
import { Route } from "./sessions";

describe("Agent Activity Sessions search", () => {
	it("keeps Project in the shared scope while accepting page-local filters", () => {
		const validateSearch = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => Record<string, unknown>;

		expect(agentActivityProjectScopeParser.parse("project-one")).toBe(
			"project-one"
		);
		expect(
			validateSearch({
				cursor: "cursor-page-2",
				member: "user-1",
				origin: "openmeld",
				project: "project-one",
				provider: "grok-build",
				query: "native-session-1",
				status: "unknown",
			})
		).toEqual({
			cursor: "cursor-page-2",
			member: "user-1",
			origin: "openmeld",
			provider: "grok-build",
			query: "native-session-1",
			status: "unknown",
		});
	});

	it("fails closed to an unfiltered view for invalid facet values", () => {
		const validateSearch = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => Record<string, unknown>;

		expect(validateSearch({ provider: "private-provider" })).toEqual({});
		expect(validateSearch({ status: "active-ish" })).toEqual({});
		expect(agentActivityProjectScopeParser.parse("   ")).toBeNull();
	});
});

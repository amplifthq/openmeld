import { describe, expect, it } from "vitest";
import {
	centerAgentDirectMessageOpenQueryOptions,
	centerAgentDirectMessageSpaceProjectionQueryOptions,
} from "#/query/organizations/center-agent";
import {
	organizationDirectoryQueryOptions,
	organizationSpacesQueryOptions,
} from "#/query/organizations/organization-directory";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import {
	PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";
import { spaceBootstrapQueryOptions } from "#/query/spaces/bootstrap";
import { spaceHistoryQueryOptions } from "#/query/spaces/history";
import { spaceMembersQueryOptions } from "#/query/spaces/members";
import { spaceStatusQueryOptions } from "#/query/spaces/status";

describe("frequently revisited route caches", () => {
	it("keeps only persisted Profile and Space list display data for seven days", () => {
		expect(
			organizationDirectoryQueryOptions({
				enabled: true,
				organizationId: "org-acme",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			organizationSpacesQueryOptions({
				enabled: true,
				organizationId: "org-acme",
			}).gcTime
		).toBe(PERSISTED_DISPLAY_QUERY_GC_TIME_MS);
		expect(
			buildStartProfilesQueryOptions({
				enabled: true,
				storageScope: "user-1",
			}).gcTime
		).toBe(PERSISTED_DISPLAY_QUERY_GC_TIME_MS);
	});

	it("keeps recent ordinary and Center Agent conversation entry data in memory", () => {
		expect(
			spaceBootstrapQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			spaceStatusQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			spaceHistoryQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			spaceMembersQueryOptions({
				enabled: true,
				spaceId: "space-1",
				openMeldProfileId: "human-1",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			centerAgentDirectMessageSpaceProjectionQueryOptions({
				enabled: true,
				organizationId: "org-acme",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(
			centerAgentDirectMessageOpenQueryOptions({
				organizationId: "org-acme",
			}).gcTime
		).toBe(ROUTE_REVISIT_GC_TIME_MS);
	});
});

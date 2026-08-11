import { describe, expect, it } from "vitest";
import { prepareSessionQueryOptions } from "./connect/prepare-session";
import { startProfilesQueryOptions } from "./profiles/profiles";
import { shouldRetryQuery } from "./query-config";
import { shouldRetrySpaceQuery } from "./spaces/retry";
import { spaceStatusQueryOptions } from "./spaces/status";

describe("query config", () => {
	it("does not retry expired-session errors", () => {
		expect(
			shouldRetryQuery(0, {
				code: "auth.unauthenticated",
				message: "authentication required",
				status: 401,
			})
		).toBe(false);
		expect(shouldRetryQuery(0, new Error("authentication required"))).toBe(
			false
		);
	});

	it("does not retry an active-organization membership mismatch", () => {
		// This is handled by the membership self-heal path, not by retrying the
		// same request against the same stale active organization.
		expect(
			shouldRetryQuery(0, {
				code: "organization.membership_required",
				message: "You are not a member of the active organization.",
				status: 403,
			})
		).toBe(false);
	});

	it("does not retry an invalid owner response", () => {
		expect(
			shouldRetryQuery(0, {
				code: "gateway.invalid_response",
				message: "The response belongs to another organization.",
				status: 200,
			})
		).toBe(false);
	});

	it("retries non-auth failures through short upstream interruptions", () => {
		expect(
			shouldRetryQuery(0, { status: 500, message: "Backend blew up" })
		).toBe(true);
		expect(
			shouldRetryQuery(1, { status: 500, message: "Backend blew up" })
		).toBe(true);
		expect(
			shouldRetryQuery(2, { status: 500, message: "Backend blew up" })
		).toBe(false);
	});

	it("keeps Start query options on the shared retry predicate", () => {
		expect(
			prepareSessionQueryOptions({
				enabled: true,
				prepareSessionId: "prepare-session-123",
				storageScope: "user-123",
			}).retry
		).toBe(shouldRetryQuery);
		expect(
			startProfilesQueryOptions({
				enabled: true,
				storageScope: "user-123",
			}).retry
		).toBe(shouldRetryQuery);
	});

	it("keeps Space query options on the protected-space-aware retry predicate", () => {
		expect(
			spaceStatusQueryOptions({
				openMeldProfileId: "profile-123",
				enabled: true,
				spaceId: "space-123",
			}).retry
		).toBe(shouldRetrySpaceQuery);
	});

	it("does not retry protected Space password challenges", () => {
		expect(
			shouldRetrySpaceQuery(0, {
				code: "space.password_required",
				message: "space password required",
				status: 403,
			})
		).toBe(false);
		expect(
			shouldRetrySpaceQuery(0, {
				code: "space.password_invalid",
				message: "space password invalid",
				status: 403,
			})
		).toBe(false);
		expect(
			shouldRetrySpaceQuery(0, {
				code: "gateway.http_error",
				message: "temporary gateway failure",
				status: 502,
			})
		).toBe(true);
	});
});

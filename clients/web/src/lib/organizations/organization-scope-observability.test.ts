import { describe, expect, it } from "vitest";
import {
	createOrganizationScopeTimingCollector,
	normalizeOrganizationScopeRouteFamilyForObservability,
} from "./organization-scope-observability";

describe("organization scope observability", () => {
	it("removes query and fragment data before recording a route family", () => {
		expect(
			normalizeOrganizationScopeRouteFamilyForObservability(
				"https://app.openmeld.ai/o/acme/center-agent/chat?code=secret#message"
			)
		).toBe("/o/acme/center-agent/chat");
		expect(
			normalizeOrganizationScopeRouteFamilyForObservability(
				"/o/acme/center-agent/chat?token=secret"
			)
		).toBe("/o/acme/center-agent/chat");
		expect(
			normalizeOrganizationScopeRouteFamilyForObservability("javascript:secret")
		).toBe("unknown_route");
		expect(
			normalizeOrganizationScopeRouteFamilyForObservability("file:///secret")
		).toBe("unknown_route");
		expect(
			normalizeOrganizationScopeRouteFamilyForObservability(
				`/${"a".repeat(600)}`
			)
		).toHaveLength(512);
	});

	it("records the context read and its total outcome", async () => {
		const times = [0, 5, 12, 30];
		const timing = createOrganizationScopeTimingCollector({
			nowMs: () => times.shift() ?? 30,
		});
		await expect(
			timing.measure("account_organization_context", () => "context")
		).resolves.toBe("context");
		expect(
			timing.finish({ reasonCode: "total_context_read", status: "succeeded" })
		).toEqual([
			{
				durationMs: 7,
				errorName: null,
				reasonCode: "account_organization_context",
				status: "succeeded",
			},
			{
				durationMs: 30,
				errorName: null,
				reasonCode: "total_context_read",
				status: "succeeded",
			},
		]);
	});

	it("preserves the failing stage without swallowing its error", async () => {
		const times = [100, 110, 120, 140];
		const timing = createOrganizationScopeTimingCollector({
			nowMs: () => times.shift() ?? 140,
		});
		const failure = new TypeError("session unavailable");

		await expect(
			timing.measure("account_organization_context", () => {
				throw failure;
			})
		).rejects.toBe(failure);

		expect(
			timing.finish({
				error: failure,
				reasonCode: "total_failed_after_account_organization_context",
				status: "failed",
			})
		).toEqual([
			{
				durationMs: 10,
				errorName: "TypeError",
				reasonCode: "account_organization_context",
				status: "failed",
			},
			{
				durationMs: 40,
				errorName: "TypeError",
				reasonCode: "total_failed_after_account_organization_context",
				status: "failed",
			},
		]);
	});
});

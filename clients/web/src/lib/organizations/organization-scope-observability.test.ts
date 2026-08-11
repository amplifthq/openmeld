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

	it("records the existing serial scope stages and one total outcome", async () => {
		const times = [0, 5, 12, 15, 20, 22, 27, 30];
		const timing = createOrganizationScopeTimingCollector({
			nowMs: () => times.shift() ?? 30,
		});

		await expect(
			timing.measure("auth_session", async () => "session")
		).resolves.toBe("session");
		await expect(
			timing.measure("organization_list", async () => ["organization"])
		).resolves.toEqual(["organization"]);
		expect(timing.measureSync("scope_resolution", () => "authorized")).toBe(
			"authorized"
		);

		expect(
			timing.finish({
				reasonCode: "total_activation_required",
				status: "succeeded",
			})
		).toEqual([
			{
				durationMs: 7,
				errorName: null,
				reasonCode: "auth_session",
				status: "succeeded",
			},
			{
				durationMs: 5,
				errorName: null,
				reasonCode: "organization_list",
				status: "succeeded",
			},
			{
				durationMs: 5,
				errorName: null,
				reasonCode: "scope_resolution",
				status: "succeeded",
			},
			{
				durationMs: 30,
				errorName: null,
				reasonCode: "total_activation_required",
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
			timing.measure("auth_session", () => {
				throw failure;
			})
		).rejects.toBe(failure);

		expect(
			timing.finish({
				error: failure,
				reasonCode: "total_failed_after_auth_session",
				status: "failed",
			})
		).toEqual([
			{
				durationMs: 10,
				errorName: "TypeError",
				reasonCode: "auth_session",
				status: "failed",
			},
			{
				durationMs: 40,
				errorName: "TypeError",
				reasonCode: "total_failed_after_auth_session",
				status: "failed",
			},
		]);
	});
});

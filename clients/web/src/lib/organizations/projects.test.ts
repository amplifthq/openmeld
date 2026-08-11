import { describe, expect, it } from "vitest";
import { resolveProjectErrorMessage } from "./projects";

describe("resolveProjectErrorMessage", () => {
	it("uses the explicit CLI slug conflict message only for an edited slug", () => {
		const error = failure("project.slug_conflict");
		expect(
			resolveProjectErrorMessage(error, "create", { explicitSlug: true })
		).toBe("That CLI slug is already in use in this workspace.");
		expect(resolveProjectErrorMessage(error, "create")).toBe(
			"OpenMeld couldn’t choose an available CLI slug. Open Advanced and enter a different one."
		);
	});

	it.each([
		[
			"project.limit_reached",
			"This workspace already has 500 active Projects. Remove an unused Project before adding another.",
		],
		[
			"project.has_activity",
			"This Project already has Activity. Only the organization owner can remove it.",
		],
	] as const)("maps %s to approved Project copy", (code, expected) => {
		expect(resolveProjectErrorMessage(failure(code), "archive")).toBe(expected);
	});
});

function failure(upstreamCode: string) {
	return {
		code: "gateway.upstream_error",
		message: "Project request failed",
		requestId: "request-1",
		status: 409,
		upstreamCode,
	};
}

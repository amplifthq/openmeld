import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { describe, expect, it } from "vitest";
import {
	isSpaceComposerSendOutcomeUnknown,
	resolveSpaceComposerSendErrorMessage,
	resolveSpaceImageUploadFailure,
} from "./errors";

function failure(
	code: StructuredApiClientFailure["code"]
): StructuredApiClientFailure {
	return {
		code,
		message: "request failed",
		requestId: null,
		status: null,
		upstreamCode: null,
	};
}

describe("Space composer send errors", () => {
	it.each([
		"network.timeout",
		"network.request_failed",
	] as const)("keeps %s honest about an unknown send outcome", (code) => {
		const error = failure(code);
		expect(isSpaceComposerSendOutcomeUnknown(error)).toBe(true);
		expect(resolveSpaceComposerSendErrorMessage(error)).toBe(
			"OpenMeld couldn't confirm this message yet. It may still appear in the Space, so wait a moment before sending it again."
		);
	});

	it("keeps a known server rejection distinct from an unknown outcome", () => {
		const error = failure("gateway.http_error");
		expect(isSpaceComposerSendOutcomeUnknown(error)).toBe(false);
		expect(resolveSpaceComposerSendErrorMessage(error)).toBe("request failed");
	});
});

describe("Space image upload errors", () => {
	it("explains an Organization mismatch and preserves its request ID", () => {
		expect(
			resolveSpaceImageUploadFailure({
				...failure("upstream_error"),
				requestId: "request-upload-403",
				status: 403,
				upstreamCode: "space.organization_mismatch",
			})
		).toEqual({
			message:
				"This image couldn't be uploaded because this Space belongs to a different Organization. Refresh the page, then try again.",
			requestId: "request-upload-403",
		});
	});

	it.each([
		"network.timeout",
		"network.request_failed",
	] as const)("gives %s a safe retry action", (code) => {
		expect(resolveSpaceImageUploadFailure(failure(code))).toEqual({
			message:
				"OpenMeld couldn't upload this image. Check your connection and try again.",
			requestId: null,
		});
	});
});

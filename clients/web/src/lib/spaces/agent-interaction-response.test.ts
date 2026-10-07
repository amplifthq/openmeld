import type {
	RespondToSpaceAgentInteractionBody,
	RespondToSpaceAgentInteractionResponse,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWebSpaceAgentInteractionResponse } from "./agent-interaction-response";

const body: RespondToSpaceAgentInteractionBody = {
	runtimeCoordinatorExecutionId: "rce_confirm",
	interactionId: "approval-1",
	response: { kind: "permission", optionId: "allow-once" },
};
const receipt: RespondToSpaceAgentInteractionResponse = {
	ok: true,
	status: "already_resolved",
	respondedAtMs: 1000,
};

describe("Space interaction response confirmation", () => {
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		"network.timeout",
		"network.request_failed",
	])("confirms an ambiguous %s using the exact original answer", async (code) => {
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(
				Object.assign(new Error("response lost"), { code })
			)
			.mockResolvedValueOnce(Response.json(receipt));
		vi.stubGlobal("fetch", fetch);
		await sendWebSpaceAgentInteractionResponse({
			body,
			openMeldProfileId: "owner",
			spaceId: "space",
		});
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls.map((call) => call[1].body)).toEqual([
			JSON.stringify(body),
			JSON.stringify(body),
		]);
	});

	it("retains an unknown result after one confirmation attempt", async () => {
		const error = Object.assign(new Error("response lost"), {
			code: "network.timeout",
		});
		const fetch = vi.fn().mockRejectedValue(error);
		vi.stubGlobal("fetch", fetch);
		await expect(
			sendWebSpaceAgentInteractionResponse({
				body,
				openMeldProfileId: "owner",
				spaceId: "space",
			})
		).rejects.toBe(error);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("preserves an explicit rejection without retrying it", async () => {
		const fetch = vi.fn().mockResolvedValue(
			Response.json({
				ok: false,
				status: "owner_mismatch",
				message: "Only the owner can respond.",
			} satisfies RespondToSpaceAgentInteractionResponse)
		);
		vi.stubGlobal("fetch", fetch);
		await expect(
			sendWebSpaceAgentInteractionResponse({
				body,
				openMeldProfileId: "owner",
				spaceId: "space",
			})
		).rejects.toThrow("Only the owner can respond.");
		expect(fetch).toHaveBeenCalledOnce();
	});
});

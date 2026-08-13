import { describe, expect, it } from "vitest";
import { resolveSlackOAuthResultMessage } from "./slack-oauth-result";

describe("Slack OAuth result copy", () => {
	it("protects the previous organization name for a non-member", () => {
		expect(
			resolveSlackOAuthResultMessage({
				error: "workspace_already_bound",
				status: "error",
			})
		).toEqual({
			description:
				"Ask the administrator who previously connected this Slack workspace to OpenMeld for help.",
			title:
				"That Slack workspace is connected to another organization you don't belong to",
			tone: "error",
		});
	});

	it("confirms a successful connection in plain language", () => {
		expect(
			resolveSlackOAuthResultMessage({ status: "connected" })
		).toMatchObject({
			title: "Slack connected",
			tone: "success",
		});
	});

	it.each([
		"expired_state",
		"invalid_state",
		"state_validation_failed",
	] as const)("points %s recovery to the Connect Slack action", (error) => {
		const message = resolveSlackOAuthResultMessage({ error, status: "error" });

		expect(message.description).toContain("Connect Slack");
		expect(message.description).not.toContain("Connect channels");
	});

	it("guides a Personal Workspace refusal to Organization creation", () => {
		expect(
			resolveSlackOAuthResultMessage({
				error: "organization_required",
				status: "error",
			})
		).toEqual({
			description:
				"Your Personal Workspace is for you only and cannot connect Slack. Create or choose an organization, then connect Slack there.",
			title: "Create an organization to connect Slack",
			tone: "error",
		});
	});
});

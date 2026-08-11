import { describe, expect, it } from "vitest";
import {
	isCenterAgentModelConfigurationChanged,
	resolveCenterAgentErrorMessage,
} from "./center-agent";

describe("resolveCenterAgentErrorMessage", () => {
	it("shows Center Agent DM open classification with the upstream code", () => {
		expect(
			resolveCenterAgentErrorMessage(
				{
					code: "center_agent.dm_open_failed",
					message:
						"invalid space id: OpenMeld couldn't resolve the durable object",
					requestId: "req-center-agent-dm",
					status: 400,
					upstreamCode: "invalid_payload",
				},
				"dm_open"
			)
		).toBe(
			"OpenMeld could not open the Center Agent conversation. Error code: center_agent.dm_open_failed / invalid_payload. Request ID: req-center-agent-dm."
		);
	});

	it("shows the bootstrap failure code and request id on designation reads", () => {
		expect(
			resolveCenterAgentErrorMessage(
				{
					code: "upstream_error",
					message: "Center Agent profile bootstrap is unavailable.",
					requestId: "req-center-agent-bootstrap",
					status: 503,
					upstreamCode: "center_agent.profile_bootstrap_unavailable",
				},
				"designation_read"
			)
		).toBe(
			"OpenMeld could not load the Center Agent designation. Error code: center_agent.profile_bootstrap_unavailable. Request ID: req-center-agent-bootstrap."
		);
	});

	it("explains the designation settling conflict without retrying automatically", () => {
		expect(
			resolveCenterAgentErrorMessage(
				{
					code: "gateway.http_error",
					message:
						"Center Agent designation was written but is not visible to dispatch yet.",
					requestId: "req-designation-not-ready",
					status: 409,
					upstreamCode: "center_agent.designation_not_ready",
				},
				"designate"
			)
		).toBe(
			"The connection is still settling. Try connecting again in a moment."
		);
	});

	it("does not surface the hidden local Center Agent binding copy", () => {
		expect(
			resolveCenterAgentErrorMessage(
				{
					code: "center_agent.profile_binding_required",
					message: "Profile binding is required.",
					requestId: "req-local-binding-required",
					status: 409,
				},
				"designate"
			)
		).toBe("OpenMeld could not update the Center Agent.");
	});

	it("keeps the original request intact when the setup link expires", () => {
		expect(
			resolveCenterAgentErrorMessage(
				{
					code: "slack.identity_link_token_invalid",
					message: "Slack identity link token is invalid or expired.",
					status: 400,
				},
				"slack_link_preview"
			)
		).toBe(
			"This setup link has expired. Return to the original Slack thread and ask the Center Agent for a new setup button. You do not need to repeat your request."
		);
	});

	it("uses the model error codes returned by Core", () => {
		expect(
			resolveCenterAgentErrorMessage(
				{
					code: "gateway.http_error",
					message: "The selected model is not in the model catalog.",
					status: 400,
					upstreamCode: "center_agent.model_invalid",
				},
				"model_update"
			)
		).toBe(
			"That Center Agent model cannot be used. Refresh this setting and choose another model."
		);
		expect(
			isCenterAgentModelConfigurationChanged({
				code: "gateway.http_error",
				message: "The Center Agent model changed in another session.",
				status: 409,
				upstreamCode: "center_agent.model_configuration_changed",
			})
		).toBe(true);
	});
});

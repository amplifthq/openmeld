import { OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID } from "@openmeld/gateway-contract";
import { describe, expect, it, vi } from "vitest";
import {
	openCenterAgentDirectMessageSpaceAtWebBoundary,
	readCenterAgentDirectMessageSpaceProjectionAtWebBoundary,
} from "./center-agent-direct-message.server";

const directMessage = {
	centerAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
	created: false,
	memberProfileId: "22222222-2222-4222-8222-222222222222",
	organizationId: "org-acme",
	spaceId: "space-ca-dm",
};

describe("Center Agent direct-message server boundary", () => {
	it("opens the DM through the authenticated Web boundary", async () => {
		const proxyRequestMock = vi.fn((input: { request: Request }) => {
			expect(input.request.url).toBe(
				"https://openmeld.test/v1/organizations/current/center-agent/dm-space"
			);
			expect(input.request.method).toBe("POST");
			expect(input.request.headers.get("cookie")).toBe("session=abc");
			expect(
				input.request.headers.get(OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID)
			).toBe("org-acme");

			return Promise.resolve(
				new Response(JSON.stringify(directMessage), {
					headers: { "content-type": "application/json" },
					status: 200,
				})
			);
		});

		await expect(
			openCenterAgentDirectMessageSpaceAtWebBoundary({
				gatewayUrl: "https://gateway.openmeld.test",
				organizationId: "org-acme",
				proxyRequestImpl: proxyRequestMock,
				requestHeaders: new Headers({ cookie: "session=abc" }),
				webAppUrl: "https://openmeld.test",
			})
		).resolves.toEqual(directMessage);
		expect(proxyRequestMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		undefined,
		"space-ca-dm",
	])("reads the selected projection through the authenticated Web boundary (%s)", async (spaceId) => {
		const projection = {
			generatedAt: "2026-07-16T05:00:00.000Z",
			organizationId: "org-acme",
			projection: {
				centerAgentProfileId: directMessage.centerAgentProfileId,
				isCenterAgentDirectMessageSpace: true,
				kind: "center_agent_direct_message_space",
				memberProfileId: directMessage.memberProfileId,
				organizationId: directMessage.organizationId,
				spaceId: directMessage.spaceId,
			},
		};
		const proxyRequestMock = vi.fn((input: { request: Request }) => {
			expect(input.request.url).toBe(
				spaceId === undefined
					? "https://openmeld.test/v1/organizations/current/center-agent/dm-space"
					: "https://openmeld.test/v1/organizations/current/center-agent/sessions/space-ca-dm"
			);
			expect(input.request.method).toBe("GET");
			expect(input.request.headers.get("cookie")).toBe("session=abc");
			expect(
				input.request.headers.get(OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID)
			).toBe("org-acme");

			return Promise.resolve(
				new Response(JSON.stringify(projection), {
					headers: { "content-type": "application/json" },
					status: 200,
				})
			);
		});

		await expect(
			readCenterAgentDirectMessageSpaceProjectionAtWebBoundary({
				...(spaceId === undefined ? {} : { spaceId }),
				gatewayUrl: "https://gateway.openmeld.test",
				organizationId: "org-acme",
				proxyRequestImpl: proxyRequestMock,
				requestHeaders: new Headers({ cookie: "session=abc" }),
				webAppUrl: "https://openmeld.test",
			})
		).resolves.toEqual(projection);
		expect(proxyRequestMock).toHaveBeenCalledTimes(1);
	});

	it("preserves the Gateway error and request id for diagnostics", async () => {
		const proxyRequestMock = vi.fn(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: {
							code: "center_agent.dm_open_failed",
							message: "The Center Agent conversation is unavailable.",
							requestId: "req-center-agent-dm",
							upstreamCode: "center_agent.dm_unavailable",
						},
						ok: false,
					}),
					{
						headers: { "content-type": "application/json" },
						status: 403,
					}
				)
			)
		);

		await expect(
			openCenterAgentDirectMessageSpaceAtWebBoundary({
				gatewayUrl: "https://gateway.openmeld.test",
				organizationId: "org-acme",
				proxyRequestImpl: proxyRequestMock,
				requestHeaders: new Headers({ cookie: "session=abc" }),
				webAppUrl: "https://openmeld.test",
			})
		).rejects.toMatchObject({
			code: "center_agent.dm_open_failed",
			requestId: "req-center-agent-dm",
			status: 403,
			upstreamCode: "center_agent.dm_unavailable",
		});
	});
});

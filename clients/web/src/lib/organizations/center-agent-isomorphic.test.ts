import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	openCenterAgentDirectMessageSpaceFromRequestMock,
	readCenterAgentDirectMessageSpaceProjectionFromRequestMock,
} = vi.hoisted(() => ({
	openCenterAgentDirectMessageSpaceFromRequestMock: vi.fn(),
	readCenterAgentDirectMessageSpaceProjectionFromRequestMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createIsomorphicFn: () => {
		const builder = {
			client: () => builder,
			server: (implementation: unknown) => implementation,
		};
		return builder;
	},
}));

vi.mock("#/env", () => ({
	getRequiredServerEnv: (name: string) => {
		if (name === "WEB_APP_URL") {
			return "https://openmeld.test";
		}
		throw new Error(`Unexpected server env: ${name}`);
	},
}));

vi.mock("./center-agent-direct-message.server", () => ({
	openCenterAgentDirectMessageSpaceFromRequest:
		openCenterAgentDirectMessageSpaceFromRequestMock,
	readCenterAgentDirectMessageSpaceProjectionFromRequest:
		readCenterAgentDirectMessageSpaceProjectionFromRequestMock,
}));

import {
	openCurrentCenterAgentDirectMessageSpace,
	readCurrentCenterAgentDirectMessageSpaceProjection,
} from "./center-agent";

describe("openCurrentCenterAgentDirectMessageSpace", () => {
	beforeEach(() => {
		openCenterAgentDirectMessageSpaceFromRequestMock.mockReset();
		readCenterAgentDirectMessageSpaceProjectionFromRequestMock.mockReset();
	});

	it("uses the request-aware server boundary during SSR", async () => {
		openCenterAgentDirectMessageSpaceFromRequestMock.mockResolvedValue({
			centerAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
			created: false,
			memberProfileId: "22222222-2222-4222-8222-222222222222",
			organizationId: "org-acme",
			spaceId: "space-ca-dm",
		});

		await expect(
			openCurrentCenterAgentDirectMessageSpace({
				organizationId: "org-acme",
			})
		).resolves.toMatchObject({ spaceId: "space-ca-dm" });
		expect(
			openCenterAgentDirectMessageSpaceFromRequestMock
		).toHaveBeenCalledWith({
			organizationId: "org-acme",
			webAppUrl: "https://openmeld.test",
		});
	});

	it("reads the existing DM projection through the request-aware server boundary during SSR", async () => {
		readCenterAgentDirectMessageSpaceProjectionFromRequestMock.mockResolvedValue(
			{
				generatedAt: "2026-07-16T05:00:00.000Z",
				organizationId: "org-acme",
				projection: {
					centerAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
					isCenterAgentDirectMessageSpace: true,
					kind: "center_agent_direct_message_space",
					memberProfileId: "22222222-2222-4222-8222-222222222222",
					organizationId: "org-acme",
					spaceId: "space-ca-dm",
				},
			}
		);

		await expect(
			readCurrentCenterAgentDirectMessageSpaceProjection({
				organizationId: "org-acme",
			})
		).resolves.toMatchObject({ projection: { spaceId: "space-ca-dm" } });
		expect(
			readCenterAgentDirectMessageSpaceProjectionFromRequestMock
		).toHaveBeenCalledWith({
			organizationId: "org-acme",
			webAppUrl: "https://openmeld.test",
		});
	});
});

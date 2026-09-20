import type { PeopleComputersResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { agentCreationComputerFixture } from "#/test-support/agent-creation-computer-fixtures";
import { readLocalRuntimes } from "./local-runtimes";

const api = vi.hoisted(() => ({
	listPeopleComputers: vi.fn(),
	getCurrentTarget: vi.fn(),
}));
vi.mock("@openmeld/api-client", async (original) => ({
	...(await original<typeof import("@openmeld/api-client")>()),
	createCurrentDeviceApi: () => api,
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createUnscopedWebOpenMeldApiFoundation: () => ({}),
}));
vi.mock("#/lib/dev/computer-state-fixtures", () => ({
	withComputerStateFixtures: (data: PeopleComputersResponse) => data,
}));

describe("Computer inventory reader", () => {
	it("returns useful inventory without issuing or waiting for a routing-preference request", async () => {
		const inventory: PeopleComputersResponse = {
			generatedAt: "2026-09-18T12:00:00.000Z",
			computers: [agentCreationComputerFixture()],
		};
		api.listPeopleComputers.mockResolvedValue(inventory);
		api.getCurrentTarget.mockReturnValue(new Promise(() => undefined));
		const resolved = vi.fn();
		readLocalRuntimes().then(resolved).catch(console.error);
		await vi.waitFor(() => expect(resolved).toHaveBeenCalledOnce());
		expect(api.getCurrentTarget).not.toHaveBeenCalled();
		expect(resolved.mock.calls[0]?.[0]).toMatchObject({
			peopleComputers: inventory,
			currentDeviceId: null,
			localRuntimes: [{ deviceId: "office-mac", isCurrent: false }],
		});
	});
});

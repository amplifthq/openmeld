import { profileWorkspaceReadResultSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import workspaceCapture from "#/test-support/profile-workspace-read.fixture.json";
import { updateAgentProfileWorkspace } from "./update-profile-workspace";

const profileId = "agt_11111111-1111-4111-8111-111111111111";
const target = { deviceId: "device-1", runtimeLane: "canary" as const };
const expectedBindingTarget = {
	bindingId: "binding-1",
	agentControllerRef: "builtin:codex",
	agentControllerConversationId: null,
	openMeldServiceRuntimeId: "runtime-1",
};
const previousWorkspace = profileWorkspaceReadResultSchema.parse(
	workspaceCapture.workspace
);
if (previousWorkspace.status !== "configured") {
	throw new Error("The capture must contain a saved working folder.");
}
const input = {
	organizationId: "organization-1",
	profileId,
	target,
	expectedBindingTarget,
	previousWorkspace,
	workspaceMode: "custom" as const,
	workspacePath: "/new-folder",
};

describe("working-folder save reconciliation", () => {
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		"confirmed",
		"unchanged",
		"different-folder",
		"binding-changed",
	])("reads the exact binding after a lost response: %s", async (outcome) => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValueOnce(
				outcome === "binding-changed"
					? Response.json(
							{
								ok: false,
								error: {
									code: "conflict",
									message: "Agent binding changed",
									requestId: "read-1",
								},
							},
							{ status: 409 }
						)
					: Response.json({
							agentProfileId: profileId,
							target,
							workspace: {
								...previousWorkspace,
								workspaceMode: "custom",
								workspacePath:
									outcome === "different-folder"
										? "/someone-elses-folder"
										: input.workspacePath,
								updatedAt:
									outcome === "unchanged"
										? previousWorkspace.updatedAt
										: "2026-10-13T00:00:00.000Z",
							},
						})
			);
		vi.stubGlobal("fetch", fetchMock);
		if (outcome === "confirmed") {
			await expect(updateAgentProfileWorkspace(input)).resolves.toBeUndefined();
		} else {
			await expect(updateAgentProfileWorkspace(input)).rejects.toMatchObject({
				message: expect.stringContaining("Failed to fetch"),
			});
		}
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [readUrl, readOptions] = fetchMock.mock.calls[1] ?? [];
		expect(readOptions?.method).toBe("GET");
		const url = new URL(String(readUrl), "http://localhost");
		expect(url.pathname).toContain("/people-computers/device-1/lanes/canary/");
		expect(
			JSON.parse(url.searchParams.get("expectedBindingTarget") ?? "null")
		).toEqual(expectedBindingTarget);
	});

	it("retains actionable admission errors without a speculative read or write retry", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json(
				{
					ok: false,
					error: {
						code: "bad_request",
						upstreamCode: "desktop.folder.account_mismatch",
						message: "Sign in with the account connected to this computer.",
						requestId: "write-1",
					},
				},
				{ status: 409 }
			)
		);
		vi.stubGlobal("fetch", fetchMock);
		await expect(updateAgentProfileWorkspace(input)).rejects.toMatchObject({
			message: "Sign in with the account connected to this computer.",
			status: 409,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

import { syncMemberAgentsResponseSchema } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import { MemberAgentAddableHarnesses } from "./member-agent-add-harnesses";

const { addMemberAgentHarnessMock, toastMock } = vi.hoisted(() => ({
	addMemberAgentHarnessMock: vi.fn(),
	toastMock: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("#/lib/member-agents/sync-member-agents", () => ({
	addMemberAgentHarness: addMemberAgentHarnessMock,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: { id: "org-1" },
	}),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function syncResponse(input: {
	addableHarnessKinds: string[];
	results?: unknown[];
}) {
	return syncMemberAgentsResponseSchema.parse({
		ok: true,
		organizationId: "org-1",
		results: input.results ?? [],
		assignedProfileIds: [],
		addableHarnessKinds: input.addableHarnessKinds,
	});
}

function renderWithSync(addableHarnessKinds: string[]) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(memberAgentQueryKeys.sync("org-1"), {
		changed: false,
		response: syncResponse({ addableHarnessKinds }),
	});
	const invalidate = vi.spyOn(queryClient, "invalidateQueries");
	render(
		<QueryClientProvider client={queryClient}>
			<MemberAgentAddableHarnesses />
		</QueryClientProvider>
	);
	return { invalidate, queryClient };
}

describe("MemberAgentAddableHarnesses", () => {
	it("renders nothing when every installed harness already has an Agent", () => {
		renderWithSync([]);
		expect(screen.queryByRole("region", { name: "Add an Agent" })).toBeNull();
	});

	it("adds a turned-off harness through Core and rereads the Agents", async () => {
		addMemberAgentHarnessMock.mockResolvedValue(
			syncResponse({
				addableHarnessKinds: [],
				results: [
					{
						binding: "succeeded",
						defaultProfileId: "agt-cursor",
						directMessage: "succeeded",
						directMessageSpaceId: "space-dm",
						harnessKind: "cursor",
						memberAgentId: "ma-cursor",
						outcome: "created",
						reasonCodes: [],
					},
				],
			})
		);
		const { invalidate } = renderWithSync(["cursor", "opencode"]);

		expect(screen.getByText("Found on your computers")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Add Cursor" }));

		await waitFor(() =>
			expect(toastMock.success).toHaveBeenCalledWith(
				"Cursor is ready. Its chat is in your Agents."
			)
		);
		expect(addMemberAgentHarnessMock).toHaveBeenCalledWith({
			harnessKind: "cursor",
			organizationId: "org-1",
		});
		expect(invalidate).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: memberAgentQueryKeys.all("org-1"),
			})
		);
		// The answer replaces the offers: nothing is left to add.
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Add OpenCode" })).toBeNull()
		);
	});

	it("says why a harness was not added and keeps the offer", async () => {
		addMemberAgentHarnessMock.mockResolvedValue(
			syncResponse({
				addableHarnessKinds: ["cursor"],
				results: [
					{
						binding: "not_attempted",
						defaultProfileId: null,
						directMessage: "not_attempted",
						directMessageSpaceId: null,
						harnessKind: "cursor",
						memberAgentId: null,
						outcome: "skipped",
						reasonCodes: ["local_agent_control.current_runtime_missing"],
					},
				],
			})
		);
		renderWithSync(["cursor"]);

		fireEvent.click(screen.getByRole("button", { name: "Add Cursor" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"OpenMeld couldn't turn Cursor on. Make sure OpenMeld Service is running on that computer, then try again."
			)
		);
		expect(screen.getByRole("button", { name: "Add Cursor" })).toBeTruthy();
	});
});

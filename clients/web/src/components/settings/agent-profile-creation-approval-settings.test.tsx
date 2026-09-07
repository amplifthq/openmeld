import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProfileCreationApprovalSettings } from "./agent-profile-creation-approval-settings";

const getPreferenceMock = vi.hoisted(() => vi.fn());
const setPreferenceMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/profiles/agent-profile-creation-requests", () => ({
	getAgentProfileCreationApprovalPreference: getPreferenceMock,
	setAgentProfileCreationApprovalPreference: setPreferenceMock,
}));

describe("AgentProfileCreationApprovalSettings", () => {
	beforeEach(() => {
		getPreferenceMock.mockReset().mockResolvedValue({
			existingSessionPolicy: "ask_every_time",
			newSessionPolicy: "ask_every_time",
			organizationId: "org-1",
			updatedAt: null,
			userId: "user-1",
		});
		setPreferenceMock.mockReset().mockImplementation(async (input) => ({
			existingSessionPolicy: input.existingSessionPolicy,
			newSessionPolicy: input.newSessionPolicy,
			organizationId: "org-1",
			updatedAt: "2026-08-20T00:00:00.000Z",
			userId: "user-1",
		}));
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders separate approval policies for new and existing sessions", async () => {
		renderSettings();

		const newSessions = await screen.findByRole("combobox", {
			name: "Start new conversations approval policy",
		});
		const existingSessions = await screen.findByRole("combobox", {
			name: "Continue or copy existing conversations approval policy",
		});
		expect(newSessions.textContent).toContain("Ask me each time");
		expect(existingSessions.textContent).toContain("Ask me each time");
		expect(setPreferenceMock).not.toHaveBeenCalled();
	});
});

function renderSettings() {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<AgentProfileCreationApprovalSettings organizationId="org-1" />
		</QueryClientProvider>
	);
}

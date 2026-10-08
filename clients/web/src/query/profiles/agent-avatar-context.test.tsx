import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { centerAgentQueryKeys } from "#/query/organizations/center-agent";
import {
	AgentAvatarProfilesProvider,
	useCenterAgentCurrentModelName,
} from "./agent-avatar-context";

const readModel = vi.hoisted(() => vi.fn());
vi.mock("#/lib/organizations/center-agent", async (importOriginal) => ({
	...(await importOriginal<object>()),
	readCurrentCenterAgentDesignation: async () => ({
		designation: { agentProfileId: "center" },
	}),
	readCurrentCenterAgentModel: readModel,
}));
vi.mock(
	"#/lib/organizations/organization-directory",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		readCurrentOrganizationProfileDirectory: async () => ({
			agentProfiles: [],
		}),
	})
);
afterEach(cleanup);
function Label({ profileId }: { profileId: string }) {
	return (
		<span data-testid={profileId}>
			{useCenterAgentCurrentModelName(profileId) ?? "No model"}
		</span>
	);
}
it("shares saved model changes across messages and hides a failed stale read", async () => {
	readModel.mockResolvedValue({
		effectiveModel: { displayName: "Claude Opus 5.5" },
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<AgentAvatarProfilesProvider organizationId="test">
				<Label profileId="center" />
				<Label profileId="other" />
			</AgentAvatarProfilesProvider>
		</QueryClientProvider>
	);
	await waitFor(() =>
		expect(screen.getByTestId("center").textContent).toBe("Claude Opus 5.5")
	);
	expect(screen.getByTestId("other").textContent).toBe("No model");
	act(() => {
		client.setQueryData(centerAgentQueryKeys.model("test"), {
			effectiveModel: { displayName: "GPT-5" },
		});
	});
	await waitFor(() =>
		expect(screen.getByTestId("center").textContent).toBe("GPT-5")
	);
	readModel.mockRejectedValue(
		Object.assign(new Error("Unavailable"), { status: 403 })
	);
	await act(async () => {
		await client.refetchQueries({
			queryKey: centerAgentQueryKeys.model("test"),
		});
	});
	await waitFor(() =>
		expect(screen.getByTestId("center").textContent).toBe("No model")
	);
	client.clear();
});

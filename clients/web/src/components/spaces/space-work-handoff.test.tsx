import type { SpaceApi } from "@openmeld/api-client";
import {
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
	spaceWorkHandoffV2Schema,
} from "@openmeld/schemas";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpaceWorkHandoffAction } from "./space-work-handoff";

const CODEX = "agt_11111111-1111-4111-8111-111111111111";
const CLAUDE = "agt_22222222-2222-4222-8222-222222222222";
const REMOTE = "agt_33333333-3333-4333-8333-333333333333";

const api = vi.hoisted(() => ({
	listSignalEnvelopes: vi.fn<SpaceApi["listSignalEnvelopes"]>(),
	getMembersSnapshot: vi.fn<SpaceApi["getMembersSnapshot"]>(),
	postNormalMessage: vi.fn<SpaceApi["postNormalMessage"]>(),
}));
vi.mock("#/lib/spaces/api", () => ({ createUnscopedWebSpaceApi: () => api }));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({ currentOrganization: { id: "org" } }),
}));
vi.mock("#/lib/organizations/projects", () => ({
	listCurrentProjects: async () => ({ projects: [] }),
	readCurrentProjectRepositorySettings: async () => ({
		settings: { repositories: [] },
	}),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it.each([
	false,
	true,
])("sends the reviewed brief without requiring a repository (files=%s)", async (withFiles) => {
	const spaceId = "a".repeat(64);
	api.listSignalEnvelopes.mockResolvedValue({
		nextCursor: null,
		envelopes: [
			{
				v: 1,
				id: "source-result",
				spaceId,
				type: "signal.text",
				ts: 1,
				profile: {
					kind: "agent",
					profileId: "planner",
					profileName: "Planner",
				},
				data: {
					text: "The review is ready.",
					meta: { messageRevision: 4 },
					files: [
						{
							fileId: "report",
							revision: 7,
							name: "report.md",
							mimeType: "text/markdown",
							sizeBytes: 12,
						},
					],
				},
			},
		],
	});
	api.getMembersSnapshot.mockResolvedValue(
		createSpaceMembersSnapshot({
			spaceId,
			agents: [
				createSpaceMemberAgentSnapshot({
					profileId: CODEX,
					profileName: "Writer",
					agentControllerRef: "builtin:codex",
				}),
				createSpaceMemberAgentSnapshot({
					profileId: CLAUDE,
					profileName: "Reviewer",
					agentControllerRef: "builtin:claude-code",
				}),
				createSpaceMemberAgentSnapshot({
					profileId: REMOTE,
					profileName: "Researcher",
					agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
				}),
			],
		})
	);
	// A failed transport leaves the complete request available for inspection and retry.
	api.postNormalMessage.mockRejectedValue(new Error("Unknown send outcome"));
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<SpaceWorkHandoffAction
				profileId="human"
				sourceSignalId="source-result"
				spaceId={spaceId}
			/>
		</QueryClientProvider>
	);
	fireEvent.click(screen.getByText("Hand off"));
	await screen.findByDisplayValue("The review is ready.");
	await screen.findByText("Researcher");
	expect(screen.queryByLabelText("Project")).toBeNull();
	if (!withFiles) {
		fireEvent.click(
			screen.getByRole("switch", { name: "Include a repository" })
		);
		expect(screen.getByLabelText("Project")).toBeTruthy();
		expect(screen.queryByText("Researcher")).toBeNull();
		fireEvent.change(screen.getByLabelText("Receiving Agent"), {
			target: { value: CODEX },
		});
		fireEvent.click(screen.getByRole("button", { name: "Hand off" }));
		expect(
			screen.getByText(
				"Choose a Project and repository, or remove the repository from this handoff."
			)
		).toBeTruthy();
		expect(api.postNormalMessage).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("switch", { name: "Include a repository" })
		);
		expect(screen.queryByLabelText("Published commit SHA")).toBeNull();
	}
	if (withFiles) {
		fireEvent.click(screen.getByLabelText("report.md · revision 7"));
		expect(screen.queryByText("Reviewer")).toBeNull();
	}
	fireEvent.change(screen.getByLabelText("Receiving Agent"), {
		target: { value: REMOTE },
	});
	fireEvent.change(screen.getByLabelText("Next steps"), {
		target: { value: "Check the conclusions." },
	});
	fireEvent.change(
		screen.getByLabelText("Completion criteria (one per line)"),
		{ target: { value: "Explain the findings." } }
	);
	fireEvent.click(screen.getByRole("button", { name: "Hand off" }));
	await waitFor(() => expect(api.postNormalMessage).toHaveBeenCalledOnce());
	const request = api.postNormalMessage.mock.calls[0]?.[0];
	if (!request) {
		throw new Error("Expected one handoff request");
	}
	const handoff = spaceWorkHandoffV2Schema.parse(request.meta?.workHandoff);
	expect(handoff).not.toHaveProperty("code");
	expect(handoff.sourceRevision).toBe(4);
	expect(handoff.files).toEqual(
		withFiles
			? [{ fileId: "report", revision: 7, relativePath: "report.md" }]
			: []
	);
	expect(request.contextSelection).toEqual({
		mode: "new",
		workspace: "isolated",
		access: "space_context",
	});
	expect(request.messageEnvelope?.activationTargets).toEqual([REMOTE]);
	expect(request.messageEnvelope?.replyToSignalId).toBe("source-result");
	expect(request.text).toContain("The review is ready.");
	fireEvent.click(await screen.findByText("Retry same handoff"));
	await waitFor(() => expect(api.postNormalMessage).toHaveBeenCalledTimes(2));
	expect(api.postNormalMessage.mock.calls[1]?.[0]).toEqual(request);
	client.clear();
});

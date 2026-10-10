import type { SpaceApi } from "@openmeld/api-client";
import {
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
	spaceWorkHandoffV2Schema,
} from "@openmeld/schemas";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import {
	onlineManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import {
	act,
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
const RETRY_SOURCE_NOTICE = /Retry will resend the original handoff/;

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
	onlineManager.setOnline(true);
	vi.clearAllMocks();
});

it.each([
	false,
	true,
])("sends the reviewed brief without requiring a repository (files=%s)", async (withFiles) => {
	const spaceId = "a".repeat(64);
	const sourceResponse: Awaited<ReturnType<SpaceApi["listSignalEnvelopes"]>> = {
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
	};
	api.listSignalEnvelopes.mockResolvedValue(sourceResponse);
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
	const acceptedIds = new Set();
	api.postNormalMessage.mockImplementation((request) => {
		acceptedIds.add(request.meta?.clientMessageId);
		return Promise.reject(new Error("Response lost after acceptance"));
	});
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
	if (!withFiles) {
		api.listSignalEnvelopes.mockResolvedValueOnce({
			...sourceResponse,
			envelopes: sourceResponse.envelopes.map((envelope) =>
				envelope.type !== "signal.text"
					? envelope
					: {
							...envelope,
							data: {
								...envelope.data,
								text: "Updated source result.",
								meta: { messageRevision: 5 },
							},
						}
			),
		});
		await act(async () => {
			await client.refetchQueries({ queryKey: ["work-handoff-source"] });
		});
		await screen.findByText("Review latest result");
		fireEvent.click(screen.getByRole("button", { name: "Hand off" }));
		expect(api.postNormalMessage).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("Review latest result"));
		expect(screen.getByDisplayValue("Check the conclusions.")).toBeTruthy();
	}
	fireEvent.click(screen.getByRole("button", { name: "Hand off" }));
	await waitFor(() => expect(api.postNormalMessage).toHaveBeenCalledOnce());
	const request = api.postNormalMessage.mock.calls[0]?.[0];
	if (!request) {
		throw new Error("Expected one handoff request");
	}
	const handoff = spaceWorkHandoffV2Schema.parse(request.meta?.workHandoff);
	expect(handoff).not.toHaveProperty("code");
	expect(handoff.sourceRevision).toBe(withFiles ? 4 : 5);
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
	expect(request.text).toContain(
		withFiles ? "The review is ready." : "Updated source result."
	);
	let finishRefetch:
		| ((value: Awaited<ReturnType<SpaceApi["listSignalEnvelopes"]>>) => void)
		| undefined;
	const source: Awaited<ReturnType<SpaceApi["listSignalEnvelopes"]>> =
		await api.listSignalEnvelopes.mock.results.at(-1)?.value;
	const readsBeforeReconnect = api.listSignalEnvelopes.mock.calls.length;
	const refetch = new Promise<
		Awaited<ReturnType<SpaceApi["listSignalEnvelopes"]>>
	>((resolve) => {
		finishRefetch = resolve;
	});
	api.listSignalEnvelopes.mockReturnValueOnce(refetch);
	act(() => {
		onlineManager.setOnline(false);
		onlineManager.setOnline(true);
	});
	await waitFor(() =>
		expect(api.listSignalEnvelopes).toHaveBeenCalledTimes(
			readsBeforeReconnect + 1
		)
	);
	expect(screen.getByDisplayValue("Check the conclusions.")).toBeTruthy();
	await act(async () => {
		finishRefetch?.({
			...source,
			envelopes: source.envelopes.map((envelope) =>
				envelope.type !== "signal.text"
					? envelope
					: {
							...envelope,
							data: {
								...envelope.data,
								meta: { messageRevision: 5 },
							},
						}
			),
		});
		await refetch;
	});
	if (withFiles) {
		expect(await screen.findByText(RETRY_SOURCE_NOTICE)).toBeTruthy();
		expect(screen.queryByText("Review latest result")).toBeNull();
	} else {
		api.listSignalEnvelopes.mockRejectedValueOnce(
			new Error("Refresh unavailable")
		);
		await act(async () => {
			await client.refetchQueries({ queryKey: ["work-handoff-source"] });
		});
		expect(
			await screen.findByText(
				"The original result could not be refreshed. Your draft and any pending request are preserved."
			)
		).toBeTruthy();
		expect(screen.getByDisplayValue("Check the conclusions.")).toBeTruthy();
	}
	fireEvent.click(await screen.findByText("Retry same handoff"));
	await waitFor(() => expect(api.postNormalMessage).toHaveBeenCalledTimes(2));
	expect(api.postNormalMessage.mock.calls[1]?.[0]).toEqual(request);
	expect(acceptedIds.size).toBe(1);
	client.clear();
});

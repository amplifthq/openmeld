import type { WakeProgressItem } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxAgentInteraction } from "./inbox-agent-interaction";

const state = vi.hoisted(() => ({
	fail: false,
	hasMore: false,
	items: [] as WakeProgressItem[],
	send: vi.fn(),
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "felix-human" },
		profilesQuery: { isPending: false },
	}),
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: { id: "org-1", slug: "acme" },
	}),
}));
vi.mock("#/query/spaces/active-wake-progress", () => ({
	spaceActiveWakeProgressSummaryQueryOptions: (input: { spaceId: string }) => ({
		queryKey: ["active-wake-progress", input.spaceId],
		queryFn: () =>
			state.fail
				? Promise.reject(new Error("Request timed out"))
				: Promise.resolve({
						items: state.items,
						pageInfo: { hasMore: state.hasMore },
					}),
		retry: false,
	}),
}));
vi.mock("#/lib/spaces/agent-interaction-response", () => ({
	isAgentInteractionResponseUnconfirmed: () => false,
	sendWebSpaceAgentInteractionResponse: state.send,
}));
vi.mock("#/query/organizations/inbox", () => ({
	invalidateInboxFacts: async () => undefined,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: (props: { children: unknown; to: string }) => (
		<a href={props.to}>{props.children as string}</a>
	),
}));

const QUESTION_ENDED = /This question has been answered or has ended/;

const target = {
	interactionId: "interaction-1",
	kind: "agent_interaction" as const,
	runtimeCoordinatorExecutionId: "rce_interaction",
	sourceSignalId: "signal-1",
	spaceId: "space-1",
	threadRootSignalId: null,
};

function pendingQuestion(): WakeProgressItem {
	return {
		clientMessageId: "client-message-1",
		dispatchId: "dispatch-1",
		failureReasonCode: null,
		message: "Claude Code is waiting for your response.",
		pendingInteraction: {
			canRespond: true,
			expiresAtMs: Date.UTC(2026, 9, 20),
			interactionId: "interaction-1",
			kind: "permission",
			request: {
				expiresAtMs: Date.UTC(2026, 9, 20),
				interactionId: "interaction-1",
				kind: "permission",
				options: [
					{ intent: "allow_once", label: "Allow once", optionId: "allow-once" },
				],
				requestedAtMs: Date.UTC(2026, 9, 19),
				subject: { type: "tool" },
				title: "Run pnpm test?",
				v: 1,
			},
			requestedAtMs: Date.UTC(2026, 9, 19),
		},
		phase: "running",
		runtimeCoordinatorExecutionId: "rce_interaction",
		sourceSignalId: "signal-1",
		targetLabel: "@claude",
		targetProfileId: "agt_claude",
		terminal: false,
		updatedAtMs: Date.UTC(2026, 9, 19),
	};
}

function renderInteraction(queryClient = new QueryClient()) {
	return render(
		<QueryClientProvider client={queryClient}>
			<InboxAgentInteraction target={target} />
		</QueryClientProvider>
	);
}

afterEach(() => {
	cleanup();
	state.fail = false;
	state.hasMore = false;
	state.items = [];
	state.send.mockReset();
});

describe("Answering an Agent's question in Inbox (§4.6)", () => {
	it("offers the harness's own options and answers through the Space", async () => {
		state.items = [pendingQuestion()];
		state.send.mockResolvedValue(undefined);
		renderInteraction();
		fireEvent.click(await screen.findByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and continue" })
		);
		await screen.findByText("Response sent");
		expect(state.send).toHaveBeenCalledWith({
			body: {
				interactionId: "interaction-1",
				response: { kind: "permission", optionId: "allow-once" },
				runtimeCoordinatorExecutionId: "rce_interaction",
			},
			openMeldProfileId: "felix-human",
			spaceId: "space-1",
		});
		expect(
			screen
				.getByRole("link", { name: "Open conversation" })
				.getAttribute("href")
		).toContain("/o/acme/spaces/space-1?focusInteractionId=interaction-1");
	});

	it("says the question ended once it was answered anywhere", async () => {
		renderInteraction();
		expect(await screen.findByText(QUESTION_ENDED)).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Open conversation" })
		).toBeTruthy();
	});

	it("drops the options once the question is answered elsewhere", async () => {
		state.items = [pendingQuestion()];
		const queryClient = new QueryClient();
		renderInteraction(queryClient);
		await screen.findByRole("radio", { name: "Allow once" });
		state.items = [];
		await queryClient.refetchQueries();
		expect(await screen.findByText(QUESTION_ENDED)).toBeTruthy();
		expect(screen.queryByRole("radio", { name: "Allow once" })).toBeNull();
	});

	it("keeps the question when a later poll fails (R4-02)", async () => {
		state.items = [pendingQuestion()];
		const queryClient = new QueryClient();
		renderInteraction(queryClient);
		await screen.findByRole("radio", { name: "Allow once" });
		state.fail = true;
		await queryClient.refetchQueries();
		expect(screen.getByRole("radio", { name: "Allow once" })).toBeTruthy();
		expect(
			screen.queryByText(
				"This question could not be loaded. Refresh to try again."
			)
		).toBeNull();
	});

	it("frames the question like the other Inbox requests (R4-06)", async () => {
		state.items = [pendingQuestion()];
		renderInteraction();
		const card = await screen
			.findByRole("group", {
				name: "Request from @claude",
			})
			.catch(() => screen.getByLabelText("Request from @claude"));
		expect(card.className).not.toContain("border-0");
	});

	it("never calls a question ended when the conversation lists only its newest work", async () => {
		state.hasMore = true;
		renderInteraction();
		expect(
			await screen.findByText("Answer this question in the conversation.")
		).toBeTruthy();
		expect(screen.queryByText(QUESTION_ENDED)).toBeNull();
	});
});

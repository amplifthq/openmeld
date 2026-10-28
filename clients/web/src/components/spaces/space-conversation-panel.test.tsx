import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
	GetSpaceMessageDetailsResponse,
	PostSpaceWakeStopResponse,
	SignalEnvelope,
	SpaceThread,
	SpaceThreadPreview,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render as renderBare,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSpaceConversationPosition } from "#/lib/space-conversation-position";
import {
	buildSpaceTimelineItems,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import { notifyResizeObservers } from "#/test-support/dom-observers.setup";
import {
	SPACE_COMPOSER_ACCESSIBLE_NAME,
	SPACE_WAKE_COMPOSER_HINT,
} from "./space-composer-copy";
import { SpaceConversationPanel } from "./space-conversation-panel";
import type { SpaceExecutionRecoveryHandler } from "./space-execution-recovery-actions";
import { SpaceHistoryRail } from "./space-history-rail";
import type { SpaceView } from "./space-view";
import { SpaceViewTabs } from "./space-view-tabs";

const COMPACT_TIME_PATTERN = /^\d{2}:\d{2}$/;
type SpaceConversationPanelInput = ComponentProps<
	typeof SpaceConversationPanel
>;
type SpaceConversationPanelViewState = SpaceConversationPanelInput["viewState"];
type SpaceConversationPanelOverrides = Partial<
	Omit<SpaceConversationPanelInput, "viewState"> &
		SpaceConversationPanelViewState
> & {
	viewState?: Partial<SpaceConversationPanelViewState>;
};

const FAILED_TEXT_PATTERN = /failed/i;
const THREAD_REPLY_PREVIEW_PATTERN = /^Open reply from Felix:/;
const UNREAD_JUMP_PATTERN = /Jump to first unread/;
const RETRY_BUTTON_NAME_PATTERN = /retry/i;
const REFERENCED_SPACE_ID = "c".repeat(64);
const SHOW_ME_AROUND_BUTTON_NAME_PATTERN = /Show me around/;
const CREATE_SPACE_BUTTON_NAME_PATTERN = /Create a Space/;
const CONNECT_MY_COMPUTER_BUTTON_NAME_PATTERN = /Connect my computer/;
const MESSAGES_FROM_DATE_MARKER_NAME_PATTERN = /Messages from/;
const OPEN_DATE_NAVIGATION_NAME_PATTERN = /Open date navigation for/;
const RUNNER_WORKING_NAME_PATTERN = /Working…/u;

// The Message Details dialog fetches through `useQuery`. Every test in this
// file except the ones that open that dialog only checks for the trigger
// button's presence, so a static "not_applicable everywhere" response is
// enough to reach the dialog's success branch without depending on real
// network I/O.
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query"
	);

	return {
		...actual,
		useQuery: (options: Parameters<typeof actual.useQuery>[0]) => {
			const isReaction = options.queryKey[0] === "space-message-reactions";
			const reactionQuery = actual.useQuery({
				...options,
				enabled: isReaction && options.enabled !== false,
			});
			const result = useQueryMock(options);
			if (isReaction || options.queryFn === actual.skipToken) {
				return reactionQuery;
			}
			return options.enabled === false ? { data: undefined } : result;
		},
	};
});

function QueryWrapper({ children }: { children: ReactNode }) {
	const [client] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false } } })
	);
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function render(ui: ReactNode) {
	return renderBare(ui, { wrapper: QueryWrapper });
}

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: {
		children: ReactNode;
		params?: { spaceId: string };
		to: string;
	}) => (
		<a href={params ? to.replace("$spaceId", params.spaceId) : to} {...props}>
			{children}
		</a>
	),
	useElementScrollRestoration: () => undefined,
	useNavigate: () => vi.fn(),
}));

vi.mock("./center-agent-computer-setup-card", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./center-agent-computer-setup-card")>();
	return {
		...actual,
		CenterAgentComputerSetupCard: (input: { target: { mode: string } }) => (
			<section data-mode={input.target.mode} data-slot="computer-setup-flow">
				Computer setup
			</section>
		),
	};
});

describe("SpaceConversationPanel", () => {
	beforeEach(() => {
		vi.stubGlobal("matchMedia", createMatchMediaMock());
		useQueryMock.mockReturnValue({
			data: createMinimalMessageDetailsResponse(),
			isError: false,
			isPending: false,
		});
	});

	afterEach(() => {
		cleanup();
		sessionStorage.clear();
		localStorage.clear();
		Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
		vi.useRealTimers();
		vi.unstubAllGlobals();
		useQueryMock.mockReset();
	});

	it.each<{
		total: number | undefined;
		enabled: boolean;
		visible: boolean;
		view?: SpaceView;
	}>([
		{ total: undefined, enabled: true, visible: false },
		{ total: 30, enabled: true, visible: false },
		{ total: 31, enabled: true, visible: true },
		{ total: 31, enabled: false, visible: false },
		{ total: 31, enabled: true, visible: false, view: "graph" },
	])("reserves history space only for a visible slider (total=$total, enabled=$enabled)", ({
		total,
		enabled,
		visible,
		view,
	}) => {
		const matchMedia = createMatchMediaMock();
		vi.stubGlobal("matchMedia", (query: string) => ({
			...matchMedia(query),
			matches:
				query === "(min-width: 640px) and (hover: hover) and (pointer: fine)",
		}));
		localStorage.setItem(
			"openmeld.space.history-slider",
			enabled ? "on" : "off"
		);
		renderSpaceConversationPanel({
			activeSpaceView: view ?? "messages",
			historyNavigation: {
				activeWindow: null,
				directory:
					total === undefined
						? undefined
						: {
								total,
								entries: [
									{
										signalId: "first-message",
										endSignalId: "last-message",
										startAt: 0,
										endAt: 1,
										count: total,
										author: "Alex",
										preview: "Earlier discussion",
									},
								],
							},
				directoryError: false,
				directoryPending: false,
				error: null,
				notice: null,
				errorDirection: undefined,
				hasHiddenLiveHistory: false,
				latest: vi.fn(),
				loadAfter: vi.fn(async () => false),
				loadBefore: vi.fn(async () => false),
				open: vi.fn(async () => true),
				hrefForSignalId: undefined,
				earlierHref: undefined,
				latestHref: undefined,
				newerHref: undefined,
				pending: false,
				pendingDirection: undefined,
				retry: vi.fn(),
				retryDirectory: vi.fn(),
				revealCachedBefore: vi.fn(),
				visibleLiveEnvelopes: [],
			},
		});
		const conversation = screen.getByLabelText("Space conversation");
		expect(conversation.getAttribute("data-space-history-rail")).toBe(
			String(visible)
		);
		expect(
			screen.queryByRole("toolbar", { name: "Browse Space history" }) !== null
		).toBe(visible);
	});

	it.each([
		true,
		false,
	])("shows one history recovery action when retryable is %s", (retryable) => {
		const error = retryable
			? "Couldn’t load this part of the conversation."
			: "This message is no longer available. Open the latest messages to continue.";
		const historyNavigation = createTestHistoryNavigation({
			error,
			errorDirection: "after",
			retry: retryable ? vi.fn() : undefined,
			activeWindow: {
				identity: "test",
				envelopes: [createThreadPreviewSignal()],
				hasBefore: true,
				hasAfter: true,
				confirmedAtLiveTail: false,
			},
		});
		renderSpaceConversationPanel({
			historyActionErrorMessage: error,
			historyNavigation,
		});
		expect(screen.getAllByRole("alert")).toHaveLength(1);
		expect(screen.queryAllByRole("button", { name: "Retry" })).toHaveLength(
			retryable ? 1 : 0
		);
		expect(screen.queryByText("Retry loading newer messages")).toBeNull();
	});

	it("does not resume a failed history-rail jump after returning to latest", async () => {
		const history = createTestHistoryNavigation({
			directory: {
				total: 200,
				entries: [
					{
						signalId: "old-target",
						endSignalId: "old-target",
						startAt: 0,
						endAt: 1,
						count: 1,
						author: "Mira",
						preview: "Old target",
					},
				],
			},
		});
		const onJump = vi.fn();
		const props: ComponentProps<typeof SpaceHistoryRail> = {
			controller: history,
			visible: true,
			items: [],
			scrollElement: null,
			onJumpToMessage: onJump,
			onFollowLatest: vi.fn(),
			onNavigateStart: vi.fn(),
			renderNavigation: (actions) => (
				<button
					onClick={() => actions.reserveLatest().navigate()}
					type="button"
				>
					Latest
				</button>
			),
		};
		const view = render(<SpaceHistoryRail {...props} />);
		const tick = document.querySelector(".space-history-tick");
		if (!tick) {
			throw new Error("Expected history target");
		}
		fireEvent.click(tick);
		await waitFor(() => expect(history.open).toHaveBeenCalled());
		fireEvent.click(screen.getByText("Latest"));
		view.rerender(
			<SpaceHistoryRail
				{...props}
				items={[createTimelineItem({ id: "old-target", text: "Old target" })]}
			/>
		);
		expect(history.latest).toHaveBeenCalledOnce();
		expect(onJump).not.toHaveBeenCalled();
	});

	it("keeps the conversation interactive when a saved anchor is not cached", () => {
		writeSpaceConversationPosition(
			"human-profile-1:space-conversation:space-view-test",
			{
				anchorSignalId: "saved-anchor",
				offsetFromVisibleTop: 20,
			}
		);
		const onLoadHistoryAround = vi.fn(async () => true);
		const historyNavigation = {
			activeWindow: null,
			directory: undefined,
			directoryError: false,
			directoryPending: false,
			error: null,
			notice: null,
			errorDirection: undefined,
			hasHiddenLiveHistory: false,
			latest: vi.fn(),
			loadAfter: vi.fn(async () => false),
			loadBefore: vi.fn(async () => false),
			open: onLoadHistoryAround,
			hrefForSignalId: undefined,
			earlierHref: undefined,
			latestHref: undefined,
			newerHref: undefined,
			pending: false,
			pendingDirection: undefined,
			retry: vi.fn(),
			retryDirectory: vi.fn(),
			revealCachedBefore: vi.fn(),
			visibleLiveEnvelopes: [],
		};
		renderSpaceConversationPanel({
			historyNavigation,
			timelineItems: [createTimelineItem({ text: "Temporary latest message" })],
		});

		expect(screen.queryByText("Restoring your reading position…")).toBeNull();
		const history = document.querySelector<HTMLElement>(
			"[data-scroll-restoration-id='space-conversation:space-view-test']"
		);
		expect(history?.getAttribute("aria-hidden")).toBeNull();
		expect(history?.hasAttribute("inert")).toBe(false);
		expect(history?.textContent).toContain("Temporary latest message");
		expect(onLoadHistoryAround).not.toHaveBeenCalled();
	});

	it("returns from the retained Graph view to Messages with the draft intact", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		renderSpaceConversationPanelWithViewTabs({
			activeSpaceView: "graph",
			allowedActions: ["post_message"],
			composerText: "Draft the follow-up.",
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "message-source",
					text: "Review the release plan.",
				}),
			],
		});

		expect(screen.queryByRole("log", { name: "Conversation history" })).toBe(
			null
		);
		expect(
			screen.queryByRole("textbox", {
				name: SPACE_COMPOSER_ACCESSIBLE_NAME,
			})
		).toBeNull();
		expect(
			await screen.findByRole("region", { name: "Space Graph" })
		).toBeTruthy();
		expect(await screen.findByText("Review the release plan.")).toBeTruthy();

		fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
		expect(
			screen.getByRole("log", { name: "Conversation history" })
		).toBeTruthy();
		expect(
			screen.getByRole("textbox", {
				name: SPACE_COMPOSER_ACCESSIBLE_NAME,
			}).textContent
		).toBe("Draft the follow-up.");
	});

	it("keeps the Messages reading position mounted across Space tabs", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		renderSpaceConversationPanelWithViewTabs({
			activeSpaceView: "messages",
			allowedActions: ["post_message"],
			readOnly: false,
			timelineItems: [
				createTimelineItem({ id: "message-source", text: "Keep this spot." }),
			],
		});
		const history = screen.getByRole("log", { name: "Conversation history" });
		fireEvent.click(screen.getByRole("tab", { name: "Files" }));
		expect(
			screen.queryByRole("log", { name: "Conversation history" })
		).toBeNull();
		expect(
			screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")
		).toBe("true");
		fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
		expect(screen.getByRole("log", { name: "Conversation history" })).toBe(
			history
		);
	});

	it("opens Graph from Message details and focuses the selected message", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		renderSpaceConversationPanelWithViewTabs({
			allowedActions: ["post_message"],
			readOnly: false,
			spaceId: "space-1",
			timelineItems: [
				createTimelineItem({
					id: "message-source",
					text: "Review the release plan.",
				}),
			],
		});

		const messageRow = screen
			.getByText("Review the release plan.")
			.closest("[data-message-row-id='message-source']");
		expect(messageRow).toBeTruthy();
		fireEvent.mouseEnter(messageRow as HTMLElement);
		fireEvent.click(
			within(messageRow as HTMLElement).getByRole("button", {
				name: "More actions",
			})
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Message details" }));
		expect(
			await screen.findByRole("dialog", { name: "Message details" })
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "View in Graph" }));

		await waitFor(() => {
			expect(screen.getByRole("region", { name: "Space Graph" })).toBeTruthy();
		});
		expect(
			screen.queryByRole("dialog", { name: "Message details" })
		).toBeNull();
		const graphMessage = within(
			screen.getByRole("region", { name: "Space Graph" })
		).getByText("Review the release plan.");
		expect(graphMessage.closest(".group")?.className).toContain("ring-2");
	});

	it("keeps earlier-history loading out of the conversation while marking it busy", () => {
		renderSpaceConversationPanel({
			isLoadingEarlierHistory: true,
			timelineItems: [createTimelineItem()],
		});

		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		expect(screen.queryByText("Loading earlier messages...")).toBeNull();
		expect(conversationLog.getAttribute("aria-busy")).toBe("true");
	});

	it("places setup guidance over the Messages scroller instead of above it", () => {
		const renderSetupGuidance = vi.fn(
			(presentation: "banner" | "empty-state") => (
				<section aria-label="Get set up">{presentation}</section>
			)
		);
		renderSpaceConversationPanel({
			renderSetupGuidance,
			timelineItems: [createTimelineItem()],
		});

		const setupGuidance = screen.getByRole("region", { name: "Get set up" });
		const messageScroller = setupGuidance.closest(
			"[data-slot='message-scroller']"
		);
		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});

		expect(messageScroller).not.toBeNull();
		expect(messageScroller?.contains(setupGuidance)).toBe(true);
		expect(conversationLog.contains(setupGuidance)).toBe(false);
		expect(renderSetupGuidance).toHaveBeenCalledWith("banner");
	});

	it("reserves the measured conversation overlay height before messages", () => {
		renderSpaceConversationPanel({
			renderSetupGuidance: () => (
				<section aria-label="Get set up">Setup guidance</section>
			),
			timelineItems: [createTimelineItem()],
		});

		const content = document.querySelector<HTMLElement>(
			"[data-slot='message-scroller-content']"
		);

		expect(content?.className).toContain(
			"pt-[var(--space-conversation-top-overlay-height,0px)]"
		);
	});

	it("keeps the overlay gap while the sticky date appears and disappears", async () => {
		renderSpaceConversationPanel({
			renderSetupGuidance: () => <section>Setup guidance</section>,
			timelineItems: [createTimelineItem()],
		});
		const viewport = screen.getByRole("log", { name: "Conversation history" });
		const marker = document.querySelector<HTMLElement>(
			"[data-conversation-date-marker]"
		);
		if (!marker) {
			throw new Error("Expected a conversation date marker");
		}
		let markerTop = 1000;
		vi.spyOn(marker, "getBoundingClientRect").mockImplementation(
			() => new DOMRect(0, markerTop, 100, 32)
		);
		fireEvent.scroll(viewport);
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='conversation-date-pill-surface']")
			).toBeNull();
		});
		const removeProperty = vi.spyOn(viewport.style, "removeProperty");
		markerTop = -100;
		fireEvent.scroll(viewport);
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='conversation-date-pill-surface']")
			).not.toBeNull();
		});
		expect(removeProperty).not.toHaveBeenCalledWith(
			"--space-conversation-top-overlay-height"
		);
		markerTop = 1000;
		fireEvent.scroll(viewport);
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='conversation-date-pill-surface']")
			).toBeNull();
		});
		expect(removeProperty).not.toHaveBeenCalledWith(
			"--space-conversation-top-overlay-height"
		);
	});

	it("places setup guidance in the centered conversation empty state until a message exists", () => {
		const renderSetupGuidance = vi.fn(
			(presentation: "banner" | "empty-state") => (
				<section aria-label="Space setup actions">{presentation}</section>
			)
		);
		renderSpaceConversationPanel({
			emptyStateDescription: "People and agents can work together here.",
			emptyStateTitle: "Start working together.",
			renderSetupGuidance,
			timelineItems: [],
		});

		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		const setupActions = screen.getByRole("region", {
			name: "Space setup actions",
		});
		const emptyItem = setupActions.closest(
			"[data-slot='message-scroller-item']"
		);

		expect(renderSetupGuidance).toHaveBeenCalledWith("empty-state");
		expect(conversationLog.contains(setupActions)).toBe(true);
		expect(emptyItem?.getAttribute("data-message-id")).toBe(
			"space-conversation-empty"
		);
		expect(screen.queryByRole("region", { name: "Get set up" })).toBeNull();
	});

	it("keeps sticky date pills below the conversation overlay", () => {
		renderSpaceConversationPanel({
			renderSetupGuidance: () => (
				<section aria-label="Get set up">Setup guidance</section>
			),
			timelineItems: [createTimelineItem()],
		});

		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		const overlay = document.querySelector<HTMLElement>(
			"[data-slot='space-conversation-top-overlay']"
		);
		const stickyDateItem = document.querySelector(
			"[data-slot='conversation-date-pill']"
		);

		if (!overlay) {
			throw new Error("Expected the conversation top overlay");
		}
		conversationLog.style.paddingTop = "16px";
		Object.defineProperty(overlay, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: 72,
				height: 72,
				left: 0,
				right: 0,
				top: 0,
				width: 0,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}),
		});

		act(() => {
			notifyResizeObservers(overlay);
		});

		expect(
			conversationLog.style.getPropertyValue("--space-conversation-sticky-top")
		).toBe("56px");
		expect((stickyDateItem as HTMLElement | null)?.style.top).toContain(
			"var(--space-conversation-sticky-top, 0px)"
		);
	});

	it("updates the sticky date immediately when the conversation overlay resizes", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 7, 10, 12));

		renderSpaceConversationPanel({
			renderSetupGuidance: () => (
				<section aria-label="Get set up">Setup guidance</section>
			),
			timelineItems: [
				createTimelineItem({
					createdAtMs: new Date(2026, 7, 9, 10).getTime(),
					id: "signal-yesterday",
					text: "Yesterday's message",
				}),
				createTimelineItem({
					createdAtMs: new Date(2026, 7, 10, 10).getTime(),
					id: "signal-today",
					text: "Today's message",
				}),
			],
		});

		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		const overlay = document.querySelector<HTMLElement>(
			"[data-slot='space-conversation-top-overlay']"
		);
		const dateMarkers = screen
			.getAllByRole("separator", {
				name: MESSAGES_FROM_DATE_MARKER_NAME_PATTERN,
			})
			.map((landmark) =>
				landmark.closest<HTMLElement>("[data-conversation-date-marker]")
			);
		const [firstDateMarker, secondDateMarker] = dateMarkers;
		if (!(overlay && firstDateMarker && secondDateMarker)) {
			throw new Error(
				"Expected the overlay and both conversation date markers."
			);
		}

		conversationLog.style.paddingTop = "16px";
		Object.defineProperty(conversationLog, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: 600,
				height: 600,
				left: 0,
				right: 800,
				top: 0,
				width: 800,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}),
		});
		Object.defineProperty(firstDateMarker, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: -68,
				height: 32,
				left: 0,
				right: 800,
				top: -100,
				width: 800,
				x: 0,
				y: -100,
				toJSON: () => ({}),
			}),
		});
		Object.defineProperty(secondDateMarker, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: 60,
				height: 32,
				left: 0,
				right: 800,
				top: 28,
				width: 800,
				x: 0,
				y: 28,
				toJSON: () => ({}),
			}),
		});
		let overlayHeight = 16;
		Object.defineProperty(overlay, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: overlayHeight,
				height: overlayHeight,
				left: 0,
				right: 800,
				top: 0,
				width: 800,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}),
		});

		act(() => {
			notifyResizeObservers(overlay);
			fireEvent.scroll(conversationLog);
		});
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='conversation-date-pill']")
					?.textContent
			).toContain("Sunday, August 9");
		});

		overlayHeight = 40;
		act(() => {
			notifyResizeObservers(overlay);
		});

		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='conversation-date-pill']")
					?.textContent
			).toContain("Today");
		});
	});

	it("anchors a local-agent request under the Wake source and submits its response", async () => {
		const onAgentInteractionResponse = vi.fn().mockResolvedValue(undefined);
		renderSpaceConversationPanel({
			ephemeralActivityItems: [
				{
					...createWakeProgressItem({ sourceSignalId: "sig-wake" }),
					pendingInteraction: {
						canRespond: true,
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-inline",
						kind: "permission",
						request: {
							expiresAtMs: Date.UTC(2026, 6, 29),
							interactionId: "interaction-inline",
							kind: "permission",
							options: [
								{
									intent: "allow_once",
									label: "Allow once",
									optionId: "allow-once",
								},
							],
							requestedAtMs: Date.UTC(2026, 6, 28),
							subject: {
								command: "pnpm test",
								type: "command",
							},
							title: "Allow this command?",
							v: 1,
						},
						requestedAtMs: Date.UTC(2026, 6, 28),
					},
					runtimeCoordinatorExecutionId: "rce_inline",
				},
			],
			onAgentInteractionResponse,
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Runner(wake) validate this change",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		const sourceMessage = screen
			.getByText("@Runner(wake) validate this change")
			.closest("[data-message-row-id='sig-wake']");
		expect(sourceMessage).not.toBeNull();
		const source = within(sourceMessage as HTMLElement);
		expect(source.getByText("Allow this command?")).toBeTruthy();
		expect(onAgentInteractionResponse).not.toHaveBeenCalled();
		fireEvent.click(source.getByRole("radio", { name: "Allow once" }));
		fireEvent.click(
			source.getByRole("button", { name: "Approve and continue" })
		);

		await waitFor(() => {
			expect(onAgentInteractionResponse).toHaveBeenCalledWith({
				interactionId: "interaction-inline",
				response: {
					kind: "permission",
					optionId: "allow-once",
				},
				runtimeCoordinatorExecutionId: "rce_inline",
			});
		});
	});

	it("keeps reused provider interaction ids isolated across inline Wake executions", () => {
		const createPanelProps = (item: WakeProgressItem) =>
			createSpaceConversationPanelProps({
				ephemeralActivityItems: [item],
				onAgentInteractionResponse: vi.fn().mockResolvedValue(undefined),
				readOnly: false,
				timelineItems: [
					createTimelineItem({
						id: "sig-wake",
						text: "@Runner(wake) validate this change",
						wakeTargetProfileIds: [TARGET_PROFILE_ID],
					}),
				],
			});
		const view = render(
			<SpaceConversationPanel
				{...createPanelProps(
					createInlinePermissionProgressItem({
						runtimeCoordinatorExecutionId: "rce-inline-first",
						title: "Allow the first execution?",
					})
				)}
			/>
		);

		fireEvent.click(screen.getByRole("radio", { name: "Allow once" }));
		view.rerender(
			<SpaceConversationPanel
				{...createPanelProps(
					createInlinePermissionProgressItem({
						runtimeCoordinatorExecutionId: "rce-inline-second",
						title: "Allow the second execution?",
					})
				)}
			/>
		);

		expect(screen.getByText("Allow the second execution?")).toBeTruthy();
		expect(
			screen
				.getByRole("radio", { name: "Allow once" })
				.getAttribute("aria-checked")
		).toBe("false");
	});

	it("mounts the pending action surface above the composer without duplicating owner actions in history", () => {
		renderSpaceConversationPanel({
			ephemeralActivityItems: [
				{
					...createWakeProgressItem({ sourceSignalId: "sig-wake" }),
					pendingInteraction: {
						canRespond: true,
						expiresAtMs: Date.UTC(2026, 6, 29),
						interactionId: "interaction-surface",
						kind: "permission",
						request: {
							expiresAtMs: Date.UTC(2026, 6, 29),
							interactionId: "interaction-surface",
							kind: "permission",
							options: [
								{
									intent: "allow_once",
									label: "Allow once",
									optionId: "allow-once",
								},
							],
							requestedAtMs: Date.UTC(2026, 6, 28),
							subject: {
								command: "pnpm test",
								type: "command",
							},
							title: "History must not duplicate this request",
							v: 1,
						},
						requestedAtMs: Date.UTC(2026, 6, 28),
					},
					runtimeCoordinatorExecutionId: "rce_surface",
				},
			],
			actionableAgentInteractionPlacement: "pending-surface",
			pendingActionSurface: (
				<div data-testid="pending-action-surface">1 action needs you</div>
			),
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Runner(wake) validate this change",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		expect(
			screen.queryByText("History must not duplicate this request")
		).toBeNull();
		const surface = screen.getByTestId("pending-action-surface");
		const composer = document.querySelector(
			'[data-slot="space-composer-section"]'
		);
		expect(composer).not.toBeNull();
		expect(composer?.contains(surface)).toBe(true);
		expect(
			surface.nextElementSibling?.contains(screen.getByRole("textbox"))
		).toBe(true);
	});

	it("gives each Space conversation a stable scroll restoration identity", () => {
		renderSpaceConversationPanel({
			spaceId: "space-1",
			timelineItems: [createTimelineItem()],
		});

		expect(
			screen
				.getByRole("log", { name: "Conversation history" })
				.getAttribute("data-scroll-restoration-id")
		).toBe("space-conversation:space-1");
	});

	it("keeps date lines in the message flow and pushes the sticky pill into the next date", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 7, 10, 12));

		renderSpaceConversationPanel({
			firstUnreadSignalId: "signal-new",
			timelineItems: [
				createTimelineItem({
					createdAtMs: new Date(2026, 7, 9, 10).getTime(),
					id: "signal-seen",
					text: "Seen yesterday",
				}),
				createTimelineItem({
					createdAtMs: new Date(2026, 7, 10, 10).getTime(),
					id: "signal-new",
					text: "First new message",
				}),
			],
			onJumpToDate: vi.fn(async () => null),
			unreadCount: 1,
			unreadStateReady: true,
		});

		const dateLandmarks = screen.getAllByRole("separator", {
			name: MESSAGES_FROM_DATE_MARKER_NAME_PATTERN,
		});
		expect(dateLandmarks).toHaveLength(2);
		for (const landmark of dateLandmarks) {
			const markerItem = landmark.closest("[data-message-id^='date-marker:']");
			expect(landmark.className).toContain("h-12");
			expect(markerItem?.className).not.toContain("sticky");
			expect(markerItem?.className).not.toContain("bg-background");
			expect(markerItem?.className).not.toContain("backdrop-blur");
			const inFlowPill = landmark.querySelector(
				"[data-conversation-date-marker-pill]"
			);
			if (inFlowPill) {
				expect(inFlowPill.className).not.toContain("sr-only");
				expect(inFlowPill.firstElementChild?.className).toContain(
					"conversation-floating-surface"
				);
			}
			expect(
				landmark.querySelector("[data-conversation-date-marker-placeholder]")
			).toBeNull();
		}

		const stickyDatePills = Array.from(
			document.querySelectorAll("[data-slot='conversation-date-pill']")
		);
		expect(stickyDatePills).toHaveLength(1);
		for (const pillItem of stickyDatePills) {
			expect(pillItem?.className).toContain("absolute");
			expect(pillItem?.className).toContain("h-8");
			expect(pillItem?.className).toContain("max-lg:h-11");
			expect((pillItem as HTMLElement).style.top).toContain(
				"var(--space-conversation-sticky-top, 0px)"
			);
			expect(pillItem?.className).not.toContain("bg-background");
			expect(pillItem?.className).not.toContain("backdrop-blur");
		}
		const stickyPillViewport = document.querySelector(
			"[data-slot='conversation-date-pill-viewport']"
		);
		expect(stickyPillViewport?.className).toContain("h-[calc(100%+0.25rem)]");
		expect(stickyPillViewport?.className).toContain("py-0.5");
		expect(stickyPillViewport?.className).not.toContain("overflow-hidden");
		expect(stickyDatePills[0]?.className).not.toContain("overflow-clip");
		const floatingDateTrack = document.querySelector(
			"[data-slot='conversation-date-pill-track']"
		);
		expect(
			floatingDateTrack?.querySelectorAll(":scope > span[aria-hidden]")
		).toHaveLength(0);
		expect(
			floatingDateTrack?.querySelector(
				"[data-slot='conversation-date-pill-surface'] .conversation-floating-surface"
			)
		).not.toBeNull();

		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		const [firstDateMarker, secondDateMarker] = dateLandmarks.map((landmark) =>
			landmark.closest<HTMLElement>("[data-conversation-date-marker]")
		);
		if (!(firstDateMarker && secondDateMarker)) {
			throw new Error("Expected two conversation date markers.");
		}
		Object.defineProperty(conversationLog, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: 600,
				height: 600,
				left: 0,
				right: 800,
				top: 0,
				width: 800,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}),
		});
		conversationLog.style.paddingTop = "16px";
		Object.defineProperty(firstDateMarker, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: -68,
				height: 32,
				left: 0,
				right: 800,
				top: -100,
				width: 800,
				x: 0,
				y: -100,
				toJSON: () => ({}),
			}),
		});
		const stickyPillSurface = document.querySelector<HTMLElement>(
			"[data-slot='conversation-date-pill-surface']"
		);
		if (!stickyPillSurface) {
			throw new Error("Expected the sticky conversation date pill surface.");
		}
		Object.defineProperty(stickyPillSurface, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: 44,
				height: 44,
				left: 0,
				right: 160,
				top: 0,
				width: 160,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}),
		});
		let secondDateMarkerTop = 20;
		Object.defineProperty(secondDateMarker, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: secondDateMarkerTop + 32,
				height: 32,
				left: 0,
				right: 800,
				top: secondDateMarkerTop,
				width: 800,
				x: 0,
				y: secondDateMarkerTop,
				toJSON: () => ({}),
			}),
		});
		fireEvent.scroll(conversationLog);

		await waitFor(() => {
			expect(
				document.querySelector<HTMLElement>(
					"[data-slot='conversation-date-pill-track']"
				)?.style.transform
			).toBe("translate3d(0, -36px, 0)");
		});
		expect(
			screen.getAllByRole("button", {
				name: "Open date navigation for Sunday, August 9",
			})
		).toHaveLength(1);
		expect(
			screen.getAllByRole("button", {
				name: "Open date navigation for Today",
			})
		).toHaveLength(1);
		expect(
			firstDateMarker.querySelector<HTMLElement>(
				"[data-conversation-date-marker-pill]"
			)?.hidden
		).toBe(true);
		expect(
			secondDateMarker.querySelector("[data-conversation-date-marker-pill]")
				?.firstElementChild?.className
		).toContain("conversation-floating-surface");

		secondDateMarkerTop = 10;
		fireEvent.scroll(conversationLog);
		await waitFor(() => {
			expect(
				document.querySelector("[data-slot='conversation-date-pill']")
					?.textContent
			).toContain("Today");
		});
		expect(
			screen.getAllByRole("button", {
				name: "Open date navigation for Sunday, August 9",
			})
		).toHaveLength(1);
		expect(
			screen.getAllByRole("button", {
				name: "Open date navigation for Today",
			})
		).toHaveLength(1);
		expect(
			secondDateMarker.querySelector<HTMLElement>(
				"[data-conversation-date-marker-pill]"
			)?.hidden
		).toBe(true);
		const stickyPillTrack = document.querySelector(
			"[data-slot='conversation-date-pill-track']"
		);
		expect(stickyPillTrack?.children).toHaveLength(1);
		expect(
			firstDateMarker.querySelector("[data-conversation-date-marker-pill]")
				?.firstElementChild?.className
		).toContain("conversation-floating-surface");

		const unreadBoundary = screen.getByRole("separator", {
			name: "New messages",
		});
		for (const divider of dateLandmarks) {
			expect(divider.className).toContain("before:bg-border");
			expect(divider.className).toContain("after:bg-border");
		}
		expect(unreadBoundary.className).toContain("before:bg-unread");
		expect(unreadBoundary.className).toContain("after:bg-unread");
		expect(unreadBoundary.className).toContain("text-unread");
		const firstNewMessage = screen
			.getByText("First new message")
			.closest("[data-message-id='signal-new']");
		const unreadBoundaryItem = unreadBoundary.closest("[data-message-id]");
		const conversationItems = Array.from(
			unreadBoundaryItem?.parentElement?.children ?? []
		);
		expect(
			conversationItems.indexOf(unreadBoundaryItem as Element)
		).toBeLessThan(conversationItems.indexOf(firstNewMessage as Element));
	});

	it("keeps the canonical unread total and navigation after revealing a target", async () => {
		const rectSpy = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement) {
				if (this.getAttribute("role") === "log") {
					return domRect({ bottom: 500, top: 0 });
				}
				if (this.hasAttribute("data-signal-id")) {
					const conversation = this.closest<HTMLElement>("[role='log']");
					const scrollTop = conversation?.scrollTop ?? 0;
					const top = this.dataset.signalId === "signal-3" ? 700 : -500;
					return domRect({
						bottom: top + 60 - scrollTop,
						top: top - scrollTop,
					});
				}
				return domRect({ bottom: 0, top: 0 });
			});
		renderSpaceConversationPanel({
			firstUnreadSignalId: "signal-1",
			timelineItems: [
				createTimelineItem({ id: "signal-1", text: "First new message" }),
				createTimelineItem({ id: "signal-2", text: "Second new message" }),
				createTimelineItem({ id: "signal-3", text: "Third new message" }),
			],
			unreadTargets: [
				{ occurredAtMs: 1, signalId: "signal-1", threadRootSignalId: null },
				{ occurredAtMs: 2, signalId: "signal-2", threadRootSignalId: null },
				{ occurredAtMs: 3, signalId: "signal-3", threadRootSignalId: null },
			],
			unreadCount: 139,
			unreadStateReady: true,
		});

		const jumpButton = await screen.findByRole("button", {
			name: "139 unread updates. Jump to first unread",
		});
		expect(
			screen.getAllByRole("button", { name: UNREAD_JUMP_PATTERN })
		).toHaveLength(1);
		fireEvent.click(jumpButton);
		await waitFor(() => expect(document.body.contains(jumpButton)).toBe(true));
		expect(document.activeElement).toBe(
			screen.getByText("First new message").closest("[data-signal-id]")
		);
		rectSpy.mockRestore();
	});

	it("finishes an unread jump when its failed history load later recovers", async () => {
		let recovered: ((result: true | "latest") => void) | undefined;
		const historyNavigation: NonNullable<
			SpaceConversationPanelInput["historyNavigation"]
		> = {
			activeWindow: null,
			directory: undefined,
			directoryError: false,
			directoryPending: false,
			error: null,
			notice: null,
			errorDirection: undefined,
			hasHiddenLiveHistory: false,
			latest: vi.fn(),
			loadAfter: vi.fn(async () => false),
			loadBefore: vi.fn(async () => false),
			open: vi.fn((_id, _signal, onLoaded) => {
				recovered = onLoaded;
				return Promise.resolve(false);
			}),
			hrefForSignalId: undefined,
			earlierHref: undefined,
			latestHref: undefined,
			newerHref: undefined,
			pending: false,
			pendingDirection: undefined,
			retry: vi.fn(),
			retryDirectory: vi.fn(),
			revealCachedBefore: vi.fn(),
			visibleLiveEnvelopes: [],
		};
		const overrides: SpaceConversationPanelOverrides = {
			historyNavigation,
			timelineItems: [
				createTimelineItem({ id: "readable", text: "Readable message" }),
			],
			unreadTargets: [
				{
					occurredAtMs: 1,
					signalId: "unread-target",
					threadRootSignalId: null,
				},
			],
			unreadCount: 1,
			unreadStateReady: true,
		};
		const view = renderSpaceConversationPanel(overrides);
		fireEvent.click(
			await screen.findByRole("button", {
				name: "1 unread update. Jump to first unread",
			})
		);
		await waitFor(() => expect(recovered).toBeTypeOf("function"));
		expect(
			screen.queryByText(
				"Couldn’t find this unread message. Refresh this Space and try again."
			)
		).toBeNull();
		await act(() => {
			recovered?.(true);
			view.rerender(
				<SpaceConversationPanel
					{...createSpaceConversationPanelProps({
						...overrides,
						timelineItems: [
							createTimelineItem({
								id: "unread-target",
								text: "Recovered unread message",
							}),
						],
					})}
				/>
			);
		});
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByText("Recovered unread message").closest("[data-signal-id]")
			)
		);
	});

	it.each([
		0.5, 0.8, 1,
	])("keeps a lower unread target inside the conversation viewport at %s scale", async (scale) => {
		const rectSpy = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement) {
				if (this.getAttribute("role") === "log") {
					return domRect({ bottom: 500 * scale, top: 0 });
				}
				if (this.hasAttribute("data-signal-id")) {
					return domRect({ bottom: 760 * scale, top: 700 * scale });
				}
				return domRect({ bottom: 0, top: 0 });
			});
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({ id: "signal-1", text: "First new message" }),
			],
			unreadTargets: [
				{ occurredAtMs: 1, signalId: "signal-1", threadRootSignalId: null },
			],
			unreadCount: 1,
			unreadStateReady: true,
		});

		const conversation = screen.getByRole("log", {
			name: "Conversation history",
		});
		conversation.scrollTop = 0;
		Object.defineProperty(conversation, "offsetHeight", {
			configurable: true,
			value: 500,
		});
		fireEvent.click(
			await screen.findByRole("button", {
				name: "1 unread update. Jump to first unread",
			})
		);

		await waitFor(() => {
			expect(conversation.scrollTop).toBe(480);
		});
		expect(document.activeElement).toBe(
			screen.getByText("First new message").closest("[data-signal-id]")
		);
		rectSpy.mockRestore();
	});

	it("shows which Agent will resume from a child result without address targets", () => {
		const childResult = createTimelineItem({
			actorName: "Runner",
			actorProfileId: TARGET_PROFILE_ID,
			actorProfileKind: "agent",
			actorProfileName: "Runner",
			id: "signal-child-result",
			text: "The review is complete.",
		});
		renderSpaceConversationPanel({
			ephemeralActivityItems: [
				{
					...createWakeProgressItem({ sourceSignalId: childResult.id }),
					clientMessageId: null,
					message: "@Amplift Center Agent · Working…...",
					targetLabel: "@Amplift Center Agent",
					targetProfileId: "agent-profile-center",
				},
			],
			timelineItems: [childResult],
		});

		expect(screen.getByTestId("space-message-continuation").textContent).toBe(
			"Auto resumes Amplift Center Agent"
		);
	});

	it("opens the exact unread thread reply from the unread navigation", async () => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
		const rectSpy = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement) {
				if (this.getAttribute("role") === "log") {
					return domRect({ bottom: 500, top: 0 });
				}
				if (this.hasAttribute("data-signal-id")) {
					return domRect({ bottom: -40, top: -100 });
				}
				return domRect({ bottom: 0, top: 0 });
			});
		const onOpenUnreadThread = vi.fn(async () => true);
		const thread = { ...createThread(), rootSignalId: "thread-root" };
		renderSpaceConversationPanel({
			onOpenUnreadThread,
			timelineItems: [createTimelineItem({ id: "thread-root" })],
			threads: [thread],
			unreadTargets: [
				{
					occurredAtMs: 1,
					signalId: "thread-reply",
					threadRootSignalId: "thread-root",
				},
			],
			unreadCount: 1,
			unreadStateReady: true,
		});

		fireEvent.click(
			await screen.findByRole("button", {
				name: "1 unread update. Jump to first unread",
			})
		);

		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: UNREAD_JUMP_PATTERN })
			).not.toBeNull()
		);
		await waitFor(() => {
			expect(onOpenUnreadThread).toHaveBeenCalledWith({
				rootSignalId: "thread-root",
				signalId: "thread-reply",
			});
		});
		rectSpy.mockRestore();
	});

	it("opens date shortcuts and delegates a selected history window", async () => {
		const onJumpToDate = vi.fn<(date: Date) => Promise<string | null>>(
			async () => "signal-1"
		);
		renderSpaceConversationPanel({
			onJumpToDate,
			timelineItems: [createTimelineItem({ text: "Latest message" })],
		});

		const stickyDatePill = document.querySelector(
			"[data-slot='conversation-date-pill']"
		);
		if (!stickyDatePill) {
			throw new Error("Expected the sticky date pill.");
		}
		const stickyDateNavigationButton = within(
			stickyDatePill as HTMLElement
		).getByRole("button", {
			name: OPEN_DATE_NAVIGATION_NAME_PATTERN,
		});
		fireEvent.click(stickyDateNavigationButton);
		expect(stickyDateNavigationButton.className).toContain(
			"conversation-floating-surface"
		);
		expect(stickyDateNavigationButton.className).toContain(
			"conversation-floating-surface"
		);
		expect(
			stickyDateNavigationButton.closest(
				'[data-slot="message-scroller-viewport"]'
			)
		).toBeNull();
		const lastWeekButton = screen.getByRole("button", { name: "Last week" });
		const chooseDateButton = screen.getByRole("button", {
			name: "Choose a date…",
		});
		const fluidGroup = lastWeekButton.closest(
			"[data-slot='shared-layout-group']"
		);
		expect(fluidGroup).not.toBeNull();
		expect(fluidGroup?.contains(chooseDateButton)).toBe(true);

		const lastWeekItem = lastWeekButton.closest(
			"[data-slot='shared-layout-item']"
		);
		const chooseDateItem = chooseDateButton.closest(
			"[data-slot='shared-layout-item']"
		);
		if (!(lastWeekItem && chooseDateItem)) {
			throw new Error("Expected date navigation Fluid items.");
		}
		fireEvent.pointerEnter(lastWeekItem);
		expect(
			fluidGroup?.querySelectorAll("[data-slot='shared-layout-background']")
		).toHaveLength(1);
		fireEvent.pointerEnter(chooseDateItem);
		expect(chooseDateItem.getAttribute("data-active")).toBe("true");
		expect(
			fluidGroup?.querySelectorAll("[data-slot='shared-layout-background']")
		).toHaveLength(1);

		fireEvent.click(lastWeekButton);

		await waitFor(() => {
			expect(onJumpToDate).toHaveBeenCalledTimes(1);
		});
		const selectedDate = onJumpToDate.mock.calls[0]?.[0];
		expect(selectedDate).toBeInstanceOf(Date);
	});

	it("opens the calendar for a specific date", () => {
		renderSpaceConversationPanel({
			onJumpToDate: vi.fn(async () => null),
			timelineItems: [createTimelineItem({ text: "Latest message" })],
		});

		const stickyDatePill = document.querySelector(
			"[data-slot='conversation-date-pill']"
		);
		if (!stickyDatePill) {
			throw new Error("Expected the sticky date pill.");
		}
		fireEvent.click(
			within(stickyDatePill as HTMLElement).getByRole("button", {
				name: OPEN_DATE_NAVIGATION_NAME_PATTERN,
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Choose a date…" }));

		expect(screen.getByText("Choose a date")).toBeTruthy();
		expect(screen.getByRole("grid")).toBeTruthy();
		const calendar = document.querySelector<HTMLElement>(
			"[data-slot='calendar']"
		);
		expect(calendar?.className).toContain("w-full");
		expect(calendar?.className).not.toContain("w-fit");
	});

	it("uses the shared Space reference renderer in a Center Agent DM", () => {
		renderSpaceConversationPanel({
			isCenterAgentDirectMessage: true,
			spaceReferencesById: new Map([
				[
					REFERENCED_SPACE_ID,
					{ name: "Launch Planning", spaceId: REFERENCED_SPACE_ID },
				],
			]),
			timelineItems: [
				createTimelineItem({
					text: `/spaces/${REFERENCED_SPACE_ID}`,
				}),
			],
		});

		expect(
			screen.getByRole("link", { name: "Open Space Launch Planning" })
		).toBeTruthy();
	});

	it("keeps Space references interactive inside a reply preview without nesting controls", () => {
		renderSpaceConversationPanel({
			spaceReferencesById: createSpaceReferences(),
			timelineItems: [
				createTimelineItem({ id: "sig-original", text: "Original message" }),
				createTimelineItem({
					id: "sig-reply",
					replyPreviewText: `/spaces/${REFERENCED_SPACE_ID}`,
					replyToProfileName: "Felix",
					replyToSignalId: "sig-original",
					text: "Reply",
				}),
			],
		});

		const link = screen.getByRole("link", {
			name: "Open Space Launch Planning",
		});
		const jumpButton = screen.getByRole("button", {
			name: "Jump to original message",
		});
		const replyProfileName = within(jumpButton).getByText("Felix");
		expect(link.closest("button")).toBeNull();
		expect(jumpButton).toBeTruthy();
		expect(replyProfileName.className).toContain("font-bold");
	});

	it.each([
		true,
		false,
	])("only omits reply quotations in one-to-one DMs (DM=%s)", (isDirectMessage) => {
		renderSpaceConversationPanel({
			isDirectMessage,
			timelineItems: [
				createTimelineItem({ id: "original", text: "Original question" }),
				createTimelineItem({
					id: "reply",
					replyToSignalId: "original",
					replyToProfileName: "Felix",
					replyPreviewText: "Original question",
					text: "The answer",
				}),
			],
		});
		expect(
			screen.queryByRole("button", { name: "Jump to original message" }) !==
				null
		).toBe(!isDirectMessage);
		expect(screen.getByText("The answer")).toBeTruthy();
	});

	it("uses the shared Space reference renderer in a thread preview", () => {
		const thread = createThread();
		const onOpenThread = vi.fn();
		const onOpenUnreadThread = vi.fn(() => true);
		renderSpaceConversationPanel({
			onOpenThread,
			onOpenUnreadThread,
			spaceReferencesById: createSpaceReferences(),
			threadPreviews: [createThreadPreview(thread.threadId)],
			threads: [thread],
			timelineItems: [
				createTimelineItem({ id: thread.rootSignalId, text: "Root message" }),
			],
		});

		const memberSpaceLink = screen.getByRole("link", {
			name: "Open Space Launch Planning",
		});
		const memberExternalLink = screen.getByRole("link", {
			name: "https://example.com",
		});
		fireEvent.click(memberSpaceLink);
		fireEvent.click(memberExternalLink);
		expect(onOpenThread).not.toHaveBeenCalled();
		const preview = screen.getByLabelText(THREAD_REPLY_PREVIEW_PATTERN);
		fireEvent.click(preview);
		fireEvent.keyDown(preview, { key: "Enter" });
		fireEvent.keyDown(preview, { key: " " });
		expect(onOpenUnreadThread).toHaveBeenCalledTimes(3);
		expect(onOpenUnreadThread).toHaveBeenLastCalledWith({
			threadId: thread.threadId,
			rootSignalId: thread.rootSignalId,
			signalId: "sig-thread-preview",
		});
		const selection = vi
			.spyOn(window, "getSelection")
			.mockReturnValue({ toString: () => "selected reply" } as Selection);
		fireEvent.click(preview);
		expect(onOpenUnreadThread).toHaveBeenCalledTimes(3);
		selection.mockRestore();
		fireEvent.pointerDown(preview, { clientX: 0, clientY: 0 });
		fireEvent.click(preview, { clientX: 10, clientY: 0 });
		expect(onOpenUnreadThread).toHaveBeenCalledTimes(3);
		fireEvent.click(
			screen.getByRole("button", { name: "Open reply from Felix" })
		);
		expect(onOpenUnreadThread).toHaveBeenCalledTimes(4);

		cleanup();
		onOpenThread.mockClear();
		onOpenUnreadThread.mockClear();
		renderSpaceConversationPanel({
			onOpenThread,
			onOpenUnreadThread,
			readOnly: true,
			spaceId: "space-123",
			spaceReferencesById: createSpaceReferences(),
			threadPreviews: [createThreadPreview(thread.threadId)],
			threads: [thread],
			timelineItems: [
				createTimelineItem({ id: thread.rootSignalId, text: "Root message" }),
			],
		});
		const publicSpaceLink = screen.getByRole("link", {
			name: "Open Space Launch Planning",
		});
		const externalLink = screen.getByRole("link", {
			name: "https://example.com",
		});
		const replyLink = screen.getByRole("link", {
			name: "Open reply from Felix",
		});
		const publicPreview = screen.getByLabelText(THREAD_REPLY_PREVIEW_PATTERN);
		expect(publicSpaceLink.parentElement?.closest("a")).toBeNull();
		expect(externalLink.parentElement?.closest("a")).toBeNull();
		expect(replyLink.getAttribute("href")).toContain(
			"threadRootSignalId=sig-root"
		);
		expect(replyLink.getAttribute("href")).toContain(
			"signalId=sig-thread-preview"
		);
		fireEvent.click(publicSpaceLink);
		fireEvent.click(externalLink);
		expect(onOpenThread).not.toHaveBeenCalled();
		fireEvent.click(publicPreview);
		expect(onOpenUnreadThread).toHaveBeenLastCalledWith({
			rootSignalId: thread.rootSignalId,
			signalId: "sig-thread-preview",
			threadId: thread.threadId,
		});
		fireEvent.click(replyLink);
		expect(onOpenUnreadThread).toHaveBeenCalledTimes(2);
		const modifiedReplyClick = new MouseEvent("click", {
			bubbles: true,
			button: 0,
			cancelable: true,
			metaKey: true,
		});
		expect(replyLink.dispatchEvent(modifiedReplyClick)).toBe(true);
		expect(onOpenUnreadThread).toHaveBeenCalledTimes(2);
	});

	it("renders structured Wake targets as inline Agent identities in the read-only main timeline", () => {
		const membersSnapshot = createWakeReceiptMembersSnapshot();
		const wakeItem = createStructuredWakeTimelineItem({
			activationTargets: [TARGET_PROFILE_ID, SECOND_TARGET_PROFILE_ID],
			membersSnapshot,
			text: "@Codex 5.6 Sol coordinate with @Claude Opus 4.8.",
		});

		renderSpaceConversationPanel({
			membersSnapshot,
			readOnly: true,
			timelineItems: [wakeItem],
		});

		expect(screen.queryByTestId("space-message-wake-receipt")).toBeNull();
		expect(screen.getByText("Codex 5.6 Sol").tagName).toBe("STRONG");
		expect(screen.getByText("Claude Opus 4.8").tagName).toBe("STRONG");
		expect(
			screen.getByTestId(`space-profile-icon-${TARGET_PROFILE_ID}`)
		).toBeTruthy();
		expect(
			screen.getByTestId(`space-profile-icon-${SECOND_TARGET_PROFILE_ID}`)
		).toBeTruthy();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("omits the redundant Wake receipt in a Center Agent Direct Message", () => {
		const membersSnapshot = createWakeReceiptMembersSnapshot();
		const wakeItem = createStructuredWakeTimelineItem({
			activationTargets: [TARGET_PROFILE_ID],
			membersSnapshot,
			text: "Draft a short story.",
		});

		renderSpaceConversationPanel({
			isCenterAgentDirectMessage: true,
			membersSnapshot,
			timelineItems: [wakeItem],
		});

		expect(screen.queryByTestId("space-message-wake-receipt")).toBeNull();
		expect(screen.getByText("Draft a short story.")).toBeTruthy();
	});

	it("keeps optimistic Center Agent identity stable while route metadata refreshes", () => {
		const sourceItem = createTimelineItem({
			id: "pending:client-message-1",
			text: "Draft a short story.",
			wakeClientMessageId: "client-message-1",
			wakeTargetProfileIds: [TARGET_PROFILE_ID],
		});
		const optimisticReplyItem = createTimelineItem({
			actorAgentControllerRef: "hosted:center-agent",
			actorName: "Center Agent",
			actorProfileId: TARGET_PROFILE_ID,
			actorProfileKind: "agent",
			actorProfileName: "Center Agent",
			createdAtMs: sourceItem.createdAtMs + 1,
			deliveryState: "pending",
			id: `active-wake:client-message-1:${TARGET_PROFILE_ID}`,
			isAgentFinalReply: true,
			activeWakeSourceItemId: sourceItem.id,
			activeWakeProgress: {
				clientMessageId: "client-message-1",
				dispatchId: "dispatch-1",
				message: "Sending message...",
				phase: "sending",
				sourceSignalId: sourceItem.id,
				targetLabel: "Center Agent",
				targetProfileId: TARGET_PROFILE_ID,
				terminal: false,
				updatedAtMs: sourceItem.createdAtMs + 1,
			},
			text: "",
		});

		renderSpaceConversationPanel({
			centerAgentProfileId: null,
			isCenterAgentDirectMessage: false,
			timelineItems: [sourceItem, optimisticReplyItem],
		});

		expect(screen.queryByTestId("space-message-wake-receipt")).toBeNull();
		expect(
			screen.getByTestId(
				`space-center-agent-profile-avatar-${TARGET_PROFILE_ID}`
			)
		).toBeTruthy();
		expect(
			screen.queryByTestId(
				`space-agent-profile-fallback-avatar-${TARGET_PROFILE_ID}`
			)
		).toBeNull();
	});

	it("keeps Wake metadata out of ordinary and structured messages", () => {
		const missingTargetProfileId = "agt_99999999-9999-4999-8999-999999999999";
		const ordinaryItem = createTimelineItem({
			id: "sig-ordinary",
			text: "Just sharing an update.",
		});
		const wakeItem = createStructuredWakeTimelineItem({
			activationTargets: [missingTargetProfileId],
			membersSnapshot: null,
			text: "Please investigate.",
		});

		renderSpaceConversationPanel({
			timelineItems: [ordinaryItem, wakeItem],
		});

		const ordinaryBubble = screen
			.getByText("Just sharing an update.")
			.closest("[data-slot='bubble-content']");
		expect(ordinaryBubble).not.toBeNull();
		expect(
			within(ordinaryBubble as HTMLElement).queryByTestId(
				"space-message-wake-receipt"
			)
		).toBeNull();
		expect(screen.queryByTestId("space-message-wake-receipt")).toBeNull();
		expect(screen.getByText("Please investigate.")).toBeTruthy();
	});

	it.each([
		["Wake", "wakeTargetProfileIds"],
		["Mention", "mentionTargetProfileIds"],
		["Reference", "referenceTargetProfileIds"],
	] as const)("shows structured Agent %s once as an inline token", (label, field) => {
		renderSpaceConversationPanel({
			membersSnapshot: createWakeReceiptMembersSnapshot(),
			timelineItems: [
				createTimelineItem({
					actorName: "Center Agent",
					actorProfileId: "agent-profile-center",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					[field]: [TARGET_PROFILE_ID],
					text: "@Codex 5.6 Sol Please check this.",
				}),
			],
		});

		expect(screen.queryByText(`${label} Codex 5.6 Sol`)).toBeNull();
		expect(screen.queryByTestId("space-message-continuation")).toBeNull();
		expect(
			screen.getByRole("button", {
				name: `Open Codex 5.6 Sol profile (${label === "Mention" ? "Mention only" : label})`,
			})
		).toBeTruthy();
	});

	it("acknowledges visible recalled messages without reading notices below the viewport", async () => {
		const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
		const geometry = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement) {
				if (this.closest('[data-signal-id="recalled-message"]')) {
					return new DOMRect(0, 150, 500, 40);
				}
				if (this.closest('[data-signal-id="unseen-recalled-message"]')) {
					return new DOMRect(0, 900, 500, 40);
				}
				return new DOMRect(0, 0, 500, 500);
			});
		const originalHitTest = Object.getOwnPropertyDescriptor(
			document,
			"elementFromPoint"
		);
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: () => document.querySelector('[data-slot="message-recalled"]'),
		});
		try {
			const item = createTimelineItem({
				id: "recalled-message",
				recalledAt: Date.UTC(2026, 4, 27, 11),
				text: "Felix recalled a message.",
			});
			const target = {
				signalId: item.id,
				occurredAtMs: item.createdAtMs,
				threadRootSignalId: null,
			};
			const onViewedUpdates = vi.fn();
			renderSpaceConversationPanel({
				onViewedUpdates,
				timelineItems: [item, { ...item, id: "unseen-recalled-message" }],
				unreadStateReady: true,
				unreadTargets: [
					target,
					{ ...target, signalId: "unseen-recalled-message" },
				],
			});
			await waitFor(() =>
				expect(onViewedUpdates).toHaveBeenCalledExactlyOnceWith([target])
			);
		} finally {
			cleanup();
			focus.mockRestore();
			geometry.mockRestore();
			if (originalHitTest) {
				Object.defineProperty(document, "elementFromPoint", originalHitTest);
			} else {
				Reflect.deleteProperty(document, "elementFromPoint");
			}
		}
	});

	it("stops advancing the unread watermark while the Graph is open", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const onViewedUpdates = vi.fn();
		renderSpaceConversationPanelWithViewTabs({
			activeSpaceView: "graph",
			onViewedUpdates,
			timelineItems: [createTimelineItem()],
		});

		expect(onViewedUpdates).not.toHaveBeenCalled();
	});

	it("loads earlier Space activity directly from the Graph", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const onLoadEarlierHistory = vi.fn().mockResolvedValue(undefined);
		renderSpaceConversationPanelWithViewTabs({
			activeSpaceView: "graph",
			hasEarlierHistory: true,
			onLoadEarlierHistory,
			timelineItems: [createTimelineItem()],
		});

		expect(screen.getByText("Drag cards to arrange")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Load earlier" }));

		expect(onLoadEarlierHistory).toHaveBeenCalledTimes(1);
	});

	it("loads earlier Space activity when the currently loaded Graph is empty", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const onLoadEarlierHistory = vi.fn().mockResolvedValue(undefined);
		renderSpaceConversationPanelWithViewTabs({
			activeSpaceView: "graph",
			hasEarlierHistory: true,
			onLoadEarlierHistory,
			timelineItems: [],
		});

		fireEvent.click(screen.getByRole("button", { name: "Load earlier" }));

		expect(onLoadEarlierHistory).toHaveBeenCalledTimes(1);
	});

	it("labels a structured Agent status as a status update in the Graph", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		renderSpaceConversationPanelWithViewTabs({
			activeSpaceView: "graph",
			hasEarlierHistory: false,
			timelineItems: [
				createTimelineItem({
					signalType: "signal.status",
					text: "Waiting for approval",
				}),
			],
		});

		expect(screen.getByText("Status update")).toBeTruthy();
	});

	it("focuses the retained source of a folded historical failure link", async () => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
		renderSpaceConversationPanel({
			initialFocusSignalId: "old-failure",
			timelineItems: [
				createTimelineItem({
					id: "source-request",
					text: "Review the proposal",
				}),
				createTimelineItem({
					id: "old-failure",
					text: "No reply was returned",
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					replyToSignalId: "source-request",
				}),
			],
		});
		await waitFor(() =>
			expect(document.activeElement?.getAttribute("data-signal-id")).toBe(
				"source-request"
			)
		);
		expect(
			screen.queryByText("This linked message isn’t available", {
				exact: false,
			})
		).toBeNull();
	});

	it("returns to Messages before resolving a same-Space message link", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
		const onLoadEarlierHistory = vi.fn().mockResolvedValue(undefined);
		const timelineItems = [
			createTimelineItem({ id: "linked-message", text: "Linked message" }),
		];
		const view = render(
			<SpaceConversationPanelHarness
				overrides={{
					activeSpaceView: "graph",
					onLoadEarlierHistory,
					timelineItems,
				}}
			/>
		);

		view.rerender(
			<SpaceConversationPanelHarness
				overrides={{
					initialFocusSignalId: "linked-message",
					onLoadEarlierHistory,
					timelineItems,
				}}
			/>
		);

		await waitFor(() => {
			expect(
				screen.getByRole("log", { name: "Conversation history" })
			).toBeTruthy();
		});
		expect(onLoadEarlierHistory).not.toHaveBeenCalled();
	});

	it("moves an unavailable linked message to the latest viewport without a failure notice", async () => {
		let finish!: (value: "latest") => void;
		const open = vi.fn(
			(
				_signalId: string,
				_signal?: AbortSignal,
				onLoaded?: (result: true | "latest") => void
			) =>
				new Promise<"latest">((resolve) => {
					finish = (value) => {
						onLoaded?.(value);
						resolve(value);
					};
				})
		);
		const historyNavigation: NonNullable<
			SpaceConversationPanelInput["historyNavigation"]
		> = {
			activeWindow: null,
			directory: undefined,
			directoryError: false,
			directoryPending: false,
			error: null,
			notice: null,
			errorDirection: undefined,
			hasHiddenLiveHistory: false,
			latest: vi.fn(),
			loadAfter: vi.fn(async () => false),
			loadBefore: vi.fn(async () => false),
			open,
			hrefForSignalId: undefined,
			earlierHref: undefined,
			latestHref: undefined,
			newerHref: undefined,
			pending: false,
			pendingDirection: undefined,
			retry: vi.fn(),
			retryDirectory: vi.fn(),
			revealCachedBefore: vi.fn(),
			visibleLiveEnvelopes: [],
		};
		const view = renderSpaceConversationPanel({
			historyNavigation,
			initialFocusSignalId: "removed-message",
			timelineItems: [createTimelineItem({ text: "Earlier message" })],
		});
		const viewport = screen.getByRole("log", { name: "Conversation history" });
		setElementScrollMetrics(viewport, {
			clientHeight: 300,
			scrollHeight: 1000,
			scrollTop: 100,
		});
		Object.defineProperty(viewport, "scrollTo", {
			configurable: true,
			value: (options: ScrollToOptions) => {
				viewport.scrollTop = Number(options.top);
			},
		});
		const notice =
			"This message is no longer available in this conversation. Showing the latest messages.";
		await act(() => {
			view.rerender(
				<SpaceConversationPanel
					{...createSpaceConversationPanelProps({
						historyNavigation: { ...historyNavigation, notice },
						initialFocusSignalId: "removed-message",
						timelineItems: [
							createTimelineItem({ id: "latest", text: "Latest message" }),
						],
					})}
				/>
			);
			finish("latest");
		});
		await waitFor(() => expect(viewport.scrollTop).toBe(700));
		expect(screen.getAllByText(notice)).toHaveLength(1);
		expect(
			screen.queryByText(
				"Couldn’t load these messages. Select a position to try again."
			)
		).toBeNull();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("shows reply staleness as muted text only on the marked message", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorName: "Runner",
					actorProfileId: "agent-profile-1",
					actorProfileKind: "agent",
					actorProfileName: "Runner",
					id: "signal-stale-agent-reply",
					newMessagesDuringComposition: 3,
					text: "Stale agent reply",
				}),
				createTimelineItem({
					actorName: "Runner",
					actorProfileId: "agent-profile-1",
					actorProfileKind: "agent",
					actorProfileName: "Runner",
					id: "signal-current-agent-reply",
					text: "Current agent reply",
				}),
			],
		});

		const staleBubble = screen
			.getByText("Stale agent reply")
			.closest("[data-signal-id]");
		const currentBubble = screen
			.getByText("Current agent reply")
			.closest("[data-signal-id]");
		if (!(staleBubble && currentBubble)) {
			throw new Error("expected both message bubbles to render");
		}
		const marker = within(staleBubble as HTMLElement).getByText(
			"written before 3 newer messages"
		);

		expect(marker.className).toContain("text-muted-foreground");
		expect(marker.className).toContain("text-xs");
		expect(
			within(currentBubble as HTMLElement).queryByText(
				"written before 3 newer messages"
			)
		).toBeNull();
	});

	it("uses native singular copy for one newer message", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorName: "Runner",
					actorProfileId: "agent-profile-1",
					actorProfileKind: "agent",
					actorProfileName: "Runner",
					id: "signal-stale-single-message-reply",
					newMessagesDuringComposition: 1,
					text: "Reply with one newer message",
				}),
			],
		});

		expect(screen.getByText("written before 1 newer message").textContent).toBe(
			"written before 1 newer message"
		);
	});

	it("preserves the first visible message when earlier history is prepended", async () => {
		const earlierMessage = createTimelineItem({
			createdAtMs: Date.UTC(2026, 4, 27, 9, 59),
			id: "signal-0",
			text: "Earlier message",
		});
		const firstMessage = createTimelineItem({
			createdAtMs: Date.UTC(2026, 4, 27, 10, 0),
			id: "signal-1",
			text: "First visible message",
		});
		const latestMessage = createTimelineItem({
			createdAtMs: Date.UTC(2026, 4, 27, 10, 2),
			id: "signal-3",
			text: "Latest visible message",
		});
		const view = renderSpaceConversationPanel({
			hasEarlierHistory: false,
			timelineItems: [firstMessage, latestMessage],
		});
		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		setElementScrollMetrics(conversationLog, {
			clientHeight: 300,
			scrollHeight: 500,
			scrollTop: 200,
		});
		let firstMessageOffsetTop = 200;
		const firstMessageItem = conversationLog.querySelector<HTMLElement>(
			"[data-message-id='signal-1']"
		);
		if (!firstMessageItem) {
			throw new Error("Expected the first visible MessageScroller item");
		}
		vi.spyOn(conversationLog, "getBoundingClientRect").mockImplementation(() =>
			createTestDomRect({ bottom: 300, height: 300, top: 0 })
		);
		vi.spyOn(firstMessageItem, "getBoundingClientRect").mockImplementation(
			() => {
				const top = firstMessageOffsetTop - conversationLog.scrollTop;
				return createTestDomRect({ bottom: top + 80, height: 80, top });
			}
		);
		fireEvent.scroll(conversationLog);
		const visibleTopBeforePrepend =
			firstMessageItem.getBoundingClientRect().top;

		firstMessageOffsetTop = 280;
		setElementScrollMetrics(conversationLog, {
			clientHeight: 300,
			scrollHeight: 580,
			scrollTop: 200,
		});
		act(() => {
			view.rerender(
				<SpaceConversationPanel
					{...createSpaceConversationPanelProps({
						hasEarlierHistory: false,
						timelineItems: [earlierMessage, firstMessage, latestMessage],
					})}
				/>
			);
		});

		await waitFor(() => {
			expect(conversationLog.scrollTop).toBe(280);
		});
		expect(firstMessageItem.getBoundingClientRect().top).toBe(
			visibleTopBeforePrepend
		);
	});

	it("keeps an explicit message jump after the bottom-following content resizes", async () => {
		const view = renderSpaceConversationPanel({
			spaceId: "space-explicit-jump-resize",
			hasEarlierHistory: false,
			timelineItems: [
				createTimelineItem({ id: "signal-target", text: "Linked message" }),
				createTimelineItem({ id: "signal-last", text: "Latest message" }),
			],
			unreadTargets: [
				{
					occurredAtMs: 1,
					signalId: "signal-target",
					threadRootSignalId: null,
				},
			],
			unreadCount: 1,
			unreadStateReady: true,
		});
		const viewport = screen.getByRole("log", { name: "Conversation history" });
		setElementScrollMetrics(viewport, {
			clientHeight: 500,
			scrollHeight: 2500,
			scrollTop: 2000,
		});
		Object.defineProperty(viewport, "offsetHeight", {
			configurable: true,
			value: 500,
		});
		Object.defineProperty(viewport, "scrollTo", {
			configurable: true,
			value: (options: ScrollToOptions) => {
				viewport.scrollTop = Number(options.top);
			},
		});
		const geometry = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement) {
				if (this === viewport) {
					return domRect({ top: 0, bottom: 500 });
				}
				const id = this.dataset.signalId ?? this.dataset.messageId;
				if (id) {
					const top = id === "signal-target" ? 700 : 2400;
					return domRect({
						top: top - viewport.scrollTop,
						bottom: top + 60 - viewport.scrollTop,
					});
				}
				return domRect({ top: 0, bottom: 0 });
			});
		fireEvent.scroll(viewport);
		fireEvent.click(
			await screen.findByRole("button", {
				name: "1 unread update. Jump to first unread",
			})
		);
		await waitFor(() => expect(viewport.scrollTop).toBe(480));
		const content = viewport.querySelector<HTMLElement>(
			"[data-slot='message-scroller-content']"
		);
		if (!content) {
			throw new Error("Expected conversation content");
		}
		await act(async () => {
			notifyResizeObservers(content);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve())
			);
		});
		expect(viewport.scrollTop).toBe(480);
		view.unmount();
		geometry.mockRestore();
	});

	it("keeps following a streaming message when the existing item grows", async () => {
		const streamingMessage = createTimelineItem({
			id: "stream-1",
			text: "Partial reply",
		});
		const view = renderSpaceConversationPanel({
			hasEarlierHistory: false,
			timelineItems: [streamingMessage],
		});
		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		const scrollerContent = conversationLog.querySelector<HTMLElement>(
			"[data-slot='message-scroller-content']"
		);
		if (!scrollerContent) {
			throw new Error("Expected MessageScroller content");
		}
		setElementScrollMetrics(conversationLog, {
			clientHeight: 320,
			scrollHeight: 960,
			scrollTop: 640,
		});
		const scrollToMock = vi.fn((options: ScrollToOptions) => {
			conversationLog.scrollTop = Number(options.top);
		});
		Object.defineProperty(conversationLog, "scrollTo", {
			configurable: true,
			value: scrollToMock,
		});

		setElementScrollMetrics(conversationLog, {
			clientHeight: 320,
			scrollHeight: 1120,
			scrollTop: 640,
		});
		act(() => {
			view.rerender(
				<SpaceConversationPanel
					{...createSpaceConversationPanelProps({
						hasEarlierHistory: false,
						timelineItems: [
							{
								...streamingMessage,
								text: "Partial reply that continued streaming",
							},
						],
					})}
				/>
			);
			notifyResizeObservers(scrollerContent);
		});

		await waitFor(() => {
			expect(scrollToMock).toHaveBeenCalledWith({
				behavior: "auto",
				top: 800,
			});
		});
		expect(conversationLog.scrollTop).toBe(800);
		expect(
			conversationLog.querySelectorAll("[data-message-id='stream-1']")
		).toHaveLength(1);
	});

	it("lets long unbroken message text wrap inside the message bubble", () => {
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				observe = vi.fn();
				disconnect = vi.fn();
				unobserve = vi.fn();
			}
		);
		const longMessage = `wake ${"x".repeat(160)} https://example.com/${"y".repeat(160)}`;
		renderSpaceConversationPanel({
			timelineItems: [createTimelineItem({ text: longMessage })],
		});

		const messageText = screen.getByText(
			(_, element) =>
				element?.textContent === longMessage &&
				![...element.children].some(
					(child) => child.textContent === longMessage
				)
		);
		const messageBubble = messageText.closest(
			"[data-slot='space-message-text-surface']"
		);

		expect(messageBubble?.className).not.toContain("min-w-[16rem]");
		expect(messageBubble?.className).toContain("max-w-full");
		expect(messageBubble?.className).toContain("text-start");
		expect(messageText.className).toContain("[overflow-wrap:anywhere]");
	});

	it("gives Agent messages a neutral surface and self messages a blue surface while preserving alignment", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorName: "Runner",
					actorProfileId: "agent-profile-1",
					actorProfileKind: "agent",
					actorProfileName: "Runner",
					id: "signal-agent",
					text: "Agent reply",
				}),
				createTimelineItem({
					id: "signal-self",
					text: "Self message",
					actorAvatarImageUrl: "https://example.com/outdated-profile.png",
				}),
			],
		});

		const agentBubble = screen
			.getByText("Agent reply")
			.closest("[data-slot='space-message-text-surface']");
		const selfBubble = screen
			.getByText("Self message")
			.closest("[data-slot='space-message-text-surface']");
		expect(agentBubble?.classList.contains("border")).toBe(true);
		expect(agentBubble?.classList.contains("border-transparent")).toBe(true);
		expect(agentBubble?.classList.contains("bg-muted/35")).toBe(true);
		expect(agentBubble?.classList.contains("max-w-full")).toBe(true);
		expect(agentBubble?.classList.contains("max-w-[62ch]")).toBe(false);
		expect(selfBubble?.classList.contains("border")).toBe(true);
		expect(selfBubble?.classList.contains("border-transparent")).toBe(true);
		expect(selfBubble?.classList.contains("bg-unread/12")).toBe(true);
		expect(selfBubble?.classList.contains("dark:bg-unread/40")).toBe(true);
		expect(selfBubble?.classList.contains("rounded-md")).toBe(true);
		expect(selfBubble?.classList.contains("max-w-full")).toBe(true);
		expect(selfBubble?.classList.contains("min-w-[16rem]")).toBe(false);
		expect(selfBubble?.classList.contains("items-start")).toBe(true);
		expect(selfBubble?.classList.contains("text-start")).toBe(true);
		expect(selfBubble?.classList.contains("text-right")).toBe(false);
		expect(selfBubble?.classList.contains("px-3")).toBe(true);
		expect(selfBubble?.classList.contains("py-2")).toBe(true);
		expect(selfBubble?.classList.contains("sm:px-4")).toBe(true);
		expect(selfBubble?.classList.contains("max-w-[62ch]")).toBe(false);
		expect(screen.getByText("Self message").className).not.toContain(
			"text-right"
		);

		const agentBubbleRoot = agentBubble?.closest("[data-slot='bubble']");
		const selfBubbleRoot = selfBubble?.closest("[data-slot='bubble']");
		const bubbleGroup = agentBubble?.closest("[data-slot='bubble-group']");
		const agentMessage = agentBubble?.closest("[data-slot='message']");
		const selfMessage = selfBubble?.closest("[data-slot='message']");
		const agentScrollerItem = agentMessage?.closest(
			"[data-slot='message-scroller-item']"
		);
		const selfScrollerItem = selfMessage?.closest(
			"[data-slot='message-scroller-item']"
		);
		const agentRow = agentBubble?.closest(
			"[data-message-row-id='signal-agent']"
		);
		const selfRow = selfBubble?.closest("[data-message-row-id='signal-self']");
		const agentHeader = agentMessage?.querySelector(
			"[data-slot='message-header']"
		);

		expect(agentBubbleRoot?.getAttribute("data-variant")).toBe("space");
		expect(agentBubbleRoot?.className).toContain("w-full");
		expect(selfBubbleRoot?.getAttribute("data-variant")).toBe("space");
		expect(selfBubbleRoot?.className).toContain("w-full");
		expect(bubbleGroup?.className).toContain("gap-0");
		expect(bubbleGroup?.className).toContain("w-full");
		// The conversation rail owns horizontal padding; the run keeps only its
		// vertical rhythm. Hover coloring must live on the per-message row so one
		// message never highlights the whole run (including its shared header).
		expect(agentMessage?.className).toContain("px-0");
		expect(agentMessage?.className).toContain("pt-1.5");
		expect(agentMessage?.className).toContain("pb-1.5");
		expect(agentMessage?.className).not.toContain("py-2");
		expect(agentMessage?.className).not.toContain("hover:bg-muted/35");
		expect(agentMessage?.className).not.toContain("focus-within:bg-muted/35");
		expect(agentMessage?.className).not.toContain("rounded-sm");
		expect(agentMessage?.textContent).toContain("Runner");
		expect(agentMessage?.textContent).toContain("Agent reply");
		expect(agentHeader?.className ?? "").toContain("mb-0.5");
		expect(agentHeader?.className ?? "").not.toContain("hover:bg-muted/35");
		expect(agentRow?.className).toContain("hover:bg-transparent");
		expect(agentRow?.className).toContain("focus-within:bg-transparent");
		expect(agentRow?.className).toContain("rounded-md");
		expect(selfMessage?.className).not.toContain("hover:bg-muted/35");
		expect(selfMessage?.className).not.toContain("focus-within:bg-muted/35");
		expect(selfMessage?.className).not.toContain("rounded-sm");
		expect(selfMessage?.className).toContain("pt-1.5");
		expect(selfMessage?.className).toContain("pb-1.5");
		expect(selfMessage?.className).not.toContain("py-2");
		expect(agentMessage?.getAttribute("data-space-self-message")).toBe("false");
		expect(selfMessage?.getAttribute("data-space-self-message")).toBe("true");
		expect(selfMessage?.textContent).toContain("Felix");
		expect(selfMessage?.textContent).toContain("Self message");
		expect(selfRow?.className).toContain("hover:bg-transparent");
		expect(selfRow?.className).toContain("focus-within:bg-transparent");
		expect(selfRow?.className).toContain("rounded-md");
		expect(
			screen.getByRole("log", { name: "Conversation history" }).className
		).toContain("py-4");
		expect(
			screen.getByRole("log", { name: "Conversation history" }).className
		).not.toContain("px-4");
		expect(
			screen.getByRole("log", { name: "Conversation history" }).className
		).not.toContain("sm:px-5");
		expect(agentScrollerItem?.getAttribute("data-message-id")).toBe(
			"signal-agent"
		);
		expect(agentScrollerItem?.getAttribute("data-scroll-anchor")).toBe("false");
		expect(selfScrollerItem?.getAttribute("data-message-id")).toBe(
			"signal-self"
		);
		expect(selfScrollerItem?.getAttribute("data-scroll-anchor")).toBe("false");
	});

	it("shows only the first message's compact time in a grouped run", () => {
		const firstCreatedAtMs = Date.UTC(2026, 4, 27, 10, 0, 0);
		const secondCreatedAtMs = Date.UTC(2026, 4, 27, 10, 3, 0);
		const firstTimeText = formatTestTime(firstCreatedAtMs);

		renderSpaceConversationPanel({
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					createdAtMs: firstCreatedAtMs,
					id: "signal-run-first",
					text: "First message in the run",
				}),
				createTimelineItem({
					createdAtMs: secondCreatedAtMs,
					id: "signal-run-second",
					text: "Second message in the run",
				}),
			],
		});

		const firstMessage = screen.getByText("First message in the run");
		const firstContent = firstMessage.closest('[data-slot="message-content"]');
		expect(
			within(firstContent as HTMLElement)
				.getByText(firstTimeText)
				.closest('[data-slot="message-header"]')
		).not.toBeNull();
		expect(firstContent?.querySelector("time")?.textContent).toMatch(
			COMPACT_TIME_PATTERN
		);
		const secondMessage = screen.getByText("Second message in the run");
		const secondContent = secondMessage.closest(
			'[data-slot="message-content"]'
		);
		expect(secondContent?.querySelector("time")).toBeNull();
	});
	it("removes external gaps between consecutive bubbles in the same run", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					createdAtMs: Date.UTC(2026, 4, 27, 10, 0, 0),
					id: "signal-run-first",
					text: "First consecutive message",
				}),
				createTimelineItem({
					createdAtMs: Date.UTC(2026, 4, 27, 10, 2, 0),
					id: "signal-run-middle",
					text: "Middle consecutive message",
				}),
				createTimelineItem({
					createdAtMs: Date.UTC(2026, 4, 27, 10, 4, 0),
					id: "signal-run-last",
					text: "Last consecutive message",
				}),
			],
		});

		const firstMessage = screen
			.getByText("First consecutive message")
			.closest("[data-slot='message']");
		const middleMessage = screen
			.getByText("Middle consecutive message")
			.closest("[data-slot='message']");
		const lastMessage = screen
			.getByText("Last consecutive message")
			.closest("[data-slot='message']");

		expect(firstMessage?.className).toContain("pt-1.5");
		expect(firstMessage?.className).toContain("pb-0");
		expect(firstMessage?.className).not.toContain("py-2");
		expect(middleMessage?.className).toContain("pt-px");
		expect(middleMessage?.className).toContain("pb-0");
		expect(lastMessage?.className).toContain("pt-px");
		expect(lastMessage?.className).toContain("pb-1.5");
		expect(lastMessage?.className).not.toContain("py-2");
	});

	it("places the speaking profile control next to the composer send action", () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			profileControl: <button type="button">Speaking as Mira</button>,
			readOnly: false,
		});

		const profileControl = screen.getByRole("button", {
			name: "Speaking as Mira",
		});
		const sendButton = screen.getByRole("button", { name: "Send message" });

		expect(profileControl.compareDocumentPosition(sendButton)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it.each([
		"wake",
		"reference",
	] as const)("offers computer recovery before sending a disconnected %s target", (relation) => {
		const profileId = "agt_22222222-2222-4222-8222-222222222222";
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			readOnly: false,
			composerText: "@Runner hello",
			composerAddressingTargets: [
				{
					profileId,
					profileName: "Runner",
					primaryMentionLabel: "Runner",
					relation,
					allowedRelations: { mention: false, reference: true, wake: false },
					wakeAvailability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText: "Connect your computer before this Agent can reply.",
					},
				},
			],
			prepareSetupHref: "/o/acme/connect",
			agentRecoveryPlansByProfileId: new Map([
				[
					profileId,
					{
						kind: "review_computer",
						profileId,
						profileName: "Runner",
						primaryActionId: "reconnect_openmeld_service",
						primaryActionLabel: "Reconnect Computer",
						recoveryReasonCode: "local_service.not_connected_for_account",
						title: "Runner’s computer is disconnected",
						secondaryLabel: "Computer not connected",
						body: "Reconnect the computer so it can receive local Wake work.",
					},
				],
			]),
		});
		const recovery = screen.queryByRole("link", { name: "Reconnect Computer" });
		if (relation === "wake") {
			expect(recovery?.getAttribute("href")).toBe("/o/acme/connect");
			expect(screen.queryByText("Computer not connected")).toBeNull();
			expect(
				screen
					.getByRole("button", { name: "Send message" })
					.hasAttribute("disabled")
			).toBe(false);
		} else {
			expect(recovery).toBeNull();
			expect(screen.queryByText("Computer not connected")).toBeNull();
			expect(
				screen
					.getByRole("button", { name: "Send message" })
					.hasAttribute("disabled")
			).toBe(false);
		}
	});

	it("shows the current recovery action beside a known blocked Wake", () => {
		const blockedProfileId = "agt_22222222-2222-4222-8222-222222222222";
		renderSpaceConversationPanel({
			agentRecoveryPlansByProfileId: new Map([
				[
					blockedProfileId,
					{
						body: "Review Runner's Agent Profile settings.",
						kind: "review_agent_profile",
						primaryActionId: "review_agent_settings",
						primaryActionLabel: "Review agent settings",
						profileId: blockedProfileId,
						profileName: "Runner",
						recoveryReasonCode: "agent_profile_binding.missing",
						secondaryLabel: "Runner needs attention.",
						title: "Runner needs attention",
					},
				],
			]),
			allowedActions: ["post_message"],
			composerAddressingTargets: [
				{
					allowedRelations: { mention: false, reference: true, wake: false },
					primaryMentionLabel: "Runner",
					profileId: blockedProfileId,
					profileName: "Runner",
					relation: "wake",
					wakeAvailability: {
						reasonCodes: ["agent_profile_binding.missing"],
						reasonText: "Runner can't reply right now.",
						status: "blocked",
					},
				},
			],
			composerBlockedWakeProfileId: blockedProfileId,
			composerErrorMessage: "Runner can't reply right now.",
			readOnly: false,
		});

		const recoveryAction = screen.getByRole("link", {
			name: "Review agent settings",
		});
		expect(recoveryAction.getAttribute("href")).toBe(
			`/o/acme/agents?profileId=${blockedProfileId}`
		);
		expect(screen.getByText("Runner can't reply right now.")).toBeTruthy();
		expect(document.body.textContent).not.toContain(
			`Profile: ${blockedProfileId}`
		);
	});

	it("lets a person send a ready file without adding filler text", async () => {
		const onSend = vi.fn(async () => undefined);
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			composerFiles: [createReadyComposerFile()],
			onSend,
			readOnly: false,
		});

		expect(screen.queryByText("1 file ready to send")).toBeNull();
		const sendButton = screen.getByRole("button", { name: "Send message" });
		expect(sendButton.hasAttribute("disabled")).toBe(false);
		fireEvent.click(sendButton);

		await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
	});

	it("preserves the message until a failed file is removed", () => {
		const onSend = vi.fn(async () => undefined);
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			composerFiles: [createFailedComposerFile()],
			composerText: "Keep the message draft",
			onSend,
			readOnly: false,
		});

		expect(
			screen.getByText("Retry or remove the failed attachment to continue.")
		).toBeTruthy();
		const sendButton = screen.getByRole("button", { name: "Send message" });
		expect(sendButton).toHaveProperty("disabled", true);
		fireEvent.click(sendButton);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("opens an upward Files menu from the composer plus button", async () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			readOnly: false,
		});

		fireEvent.click(screen.getByRole("button", { name: "Add" }));

		expect(await screen.findByRole("menuitem", { name: "Files" })).toBeTruthy();
	});

	it("opens the existing member picker from Add", async () => {
		const onAddPeopleOrAgents = vi.fn();
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			onAddPeopleOrAgents,
			readOnly: false,
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "People or agents" })
		);
		expect(onAddPeopleOrAgents).toHaveBeenCalledOnce();
	});

	it.each([
		false,
		true,
	])("keeps attachment-only messages outside the text bubble and opens the exact file (DM=%s)", (isDirectMessage) => {
		const onOpenSpaceFile = vi.fn();
		renderSpaceConversationPanel({
			isDirectMessage,
			onOpenSpaceFile,
			timelineItems: [
				createTimelineItem({
					editedAt: Date.UTC(2026, 8, 26),
					files: [
						{
							fileId: "file-1",
							localPreviewUrl: null,
							mimeType: "application/pdf",
							name: "launch-brief.pdf",
							revision: 3,
							sizeBytes: 4096,
						},
					],
					text: "",
				}),
			],
		});

		const fileButton = screen.getByText("launch-brief.pdf").closest("button");
		expect(fileButton).not.toBeNull();
		expect(
			fileButton?.closest("[data-slot='space-message-text-surface']")
		).toBeNull();
		const message = fileButton?.closest("[data-slot='bubble-content']");
		expect(
			message?.querySelector("[data-slot='space-message-edited']")?.textContent
		).toBe("(edited)");
		expect(
			message?.querySelectorAll("[data-slot='space-attachment-strip']")
		).toHaveLength(1);
		expect(
			message?.querySelector("[data-slot='space-message-text-surface']")
				?.childElementCount
		).toBe(0);
		expect(
			fileButton?.closest("[data-slot='bubble']")?.className
		).not.toContain("hidden");
		if (fileButton) {
			fireEvent.click(fileButton);
		}

		expect(onOpenSpaceFile).toHaveBeenCalledWith("file-1", 3);
	});

	it("keeps the ordinary Space composer actions flush and aligned with send availability", () => {
		const onMentionButtonClick = vi.fn();
		const view = renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			onMentionButtonClick,
			readOnly: false,
		});

		expect(
			screen
				.getByRole("textbox", {
					name: SPACE_COMPOSER_ACCESSIBLE_NAME,
				})
				.getAttribute("aria-placeholder")
		).toBe(SPACE_WAKE_COMPOSER_HINT);
		const mentionButton = screen.getByRole("button", {
			name: "Mention a member",
		});
		const addButton = screen.getByRole("button", { name: "Add" });
		expect(mentionButton.parentElement?.className).toContain("gap-0");
		expect(addButton).toHaveProperty("disabled", false);
		expect(mentionButton).toHaveProperty("disabled", false);
		fireEvent.click(mentionButton);
		expect(onMentionButtonClick).toHaveBeenCalledOnce();

		view.rerender(
			<SpaceConversationPanel
				{...createSpaceConversationPanelProps({
					allowedActions: [],
					onMentionButtonClick,
					readOnly: false,
				})}
			/>
		);

		expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
			"disabled",
			false
		);
		expect(
			screen.getByRole("button", { name: "Mention a member" })
		).toHaveProperty("disabled", false);
		expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
			"disabled",
			true
		);
	});

	it("uses the Agent name as the Agent DM placeholder", () => {
		renderSpaceConversationPanel({
			automaticWakeConversationKind: "one_human_agent",
			allowedActions: ["post_message"],
			isDirectMessage: true,
			membersSnapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						profileName: "Codex",
					}),
				],
			}),
			readOnly: false,
		});

		expect(
			screen
				.getByRole("textbox", { name: "Message Codex" })
				.getAttribute("aria-placeholder")
		).toBe("Message Codex…");
		expect(
			screen.queryByRole("button", { name: "Mention a member" })
		).toBeNull();
		expect(
			screen.queryByText("In this DM, @ is optional. Sending wakes the agent.")
		).toBeNull();
	});

	it("uses the Human name as the Human-only DM placeholder", () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			isDirectMessage: true,
			membersSnapshot: createSpaceMembersSnapshot({
				humans: [
					createSpaceMemberHumanSnapshot({
						profileId: "11111111-1111-4111-8111-111111111111",
						profileName: "Mira",
					}),
					createSpaceMemberHumanSnapshot({
						profileId: "22222222-2222-4222-8222-222222222222",
						profileName: "Felix",
					}),
				],
			}),
			readOnly: false,
			selfProfileId: "11111111-1111-4111-8111-111111111111",
		});

		expect(
			screen
				.getByRole("textbox", { name: "Message Felix" })
				.getAttribute("aria-placeholder")
		).toBe("Message Felix…");
	});

	it("uses dedicated Center Agent copy and hides the redundant @ button", () => {
		renderSpaceConversationPanel({
			automaticWakeConversationKind: "one_human_agent",
			allowedActions: ["post_message"],
			isCenterAgentDirectMessage: true,
			isDirectMessage: true,
			readOnly: false,
		});

		expect(
			screen
				.getByRole("textbox", {
					name: "Message Center Agent",
				})
				.getAttribute("aria-placeholder")
		).toBe("Tell Center Agent what you need…");
		expect(
			screen.queryByRole("button", { name: "Mention a member" })
		).toBeNull();
	});

	it("renders Human Mention as a fixed @ mark without an Agent relation selector", () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			composerAuthoredMentions: [
				{
					end: 6,
					profileId: "22222222-2222-4222-8222-222222222222",
					relation: "mention",
					start: 0,
					text: "@Felix",
				},
			],
			composerAddressingTargets: [
				{
					allowedRelations: {
						mention: true,
						reference: false,
						wake: false,
					},
					profileId: "22222222-2222-4222-8222-222222222222",
					profileName: "Felix",
					primaryMentionLabel: "Felix",
					relation: "mention",
					wakeAvailability: {
						reasonCodes: [],
						reasonText: null,
						status: "unsupported",
					},
				},
			],
			composerText: "@Felix",
			readOnly: false,
		});

		const token = screen.getByTestId("space-composer-profile-token");
		expect(within(token).getByText("Felix")).toBeTruthy();
		expect(
			screen.queryByRole("combobox", { name: "Change relation for Felix" })
		).toBeNull();
	});

	it("keeps ordinary Spaces and agent direct messages full width", () => {
		const view = renderSpaceConversationPanel({
			timelineItems: [createTimelineItem({ text: "Ordinary Space message" })],
		});
		let scrollerContent = screen
			.getByRole("log", { name: "Conversation history" })
			.querySelector("[data-slot='message-scroller-content']");

		expect(scrollerContent?.className).toContain("w-full");
		expect(scrollerContent?.className).not.toContain("mx-auto");
		expect(scrollerContent?.className).not.toContain("max-w-3xl");
		expect(scrollerContent?.className).not.toContain("max-w-6xl");

		view.unmount();
		renderSpaceConversationPanel({
			automaticWakeConversationKind: "one_human_agent",
			timelineItems: [createTimelineItem({ text: "Center Agent DM message" })],
		});
		scrollerContent = screen
			.getByRole("log", { name: "Conversation history" })
			.querySelector("[data-slot='message-scroller-content']");

		expect(scrollerContent?.className).toContain("w-full");
		expect(scrollerContent?.className).not.toContain("mx-auto");
		expect(scrollerContent?.className).not.toContain("max-w-3xl");
		expect(scrollerContent?.className).not.toContain("max-w-6xl");
	});

	it("keeps direct-message times in each message toolbar instead of above the bubbles", () => {
		renderSpaceConversationPanel({
			isDirectMessage: true,
			timelineItems: [
				createTimelineItem({
					createdAtMs: Date.UTC(2026, 8, 23, 10, 7),
					id: "dm-first",
					text: "First DM message",
				}),
				createTimelineItem({
					createdAtMs: Date.UTC(2026, 8, 23, 10, 9),
					id: "dm-second",
					text: "Second DM message",
				}),
			],
		});

		const rows = ["dm-first", "dm-second"].map((id) =>
			document.querySelector(`[data-message-row-id="${id}"]`)
		);
		for (const row of rows) {
			expect(row).toBeTruthy();
			expect(
				row?.querySelector('[data-slot="message-footer"] time')?.textContent
			).toMatch(COMPACT_TIME_PATTERN);
			expect(
				row
					?.closest('[data-slot="message-content"]')
					?.querySelector('[data-slot="message-header"] time')
			).toBeNull();
		}
		expect(rows[0]?.querySelector("time")?.textContent).not.toBe(
			rows[1]?.querySelector("time")?.textContent
		);
	});

	it("keeps the scroll viewport full width while constraining conversation content and the composer", () => {
		const view = renderSpaceConversationPanel({ readOnly: false });
		let conversation = screen.getByRole("region", {
			name: "Space conversation",
		});
		let conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});

		expect(
			conversation.hasAttribute("data-space-conversation-content-width")
		).toBe(false);
		expect(
			conversationLog.hasAttribute("data-space-conversation-content-width")
		).toBe(false);
		expect(
			conversationLog.querySelector("[data-space-conversation-content-width]")
		).toBeTruthy();
		expect(
			screen
				.getByRole("textbox", {
					name: SPACE_COMPOSER_ACCESSIBLE_NAME,
				})
				.closest("[data-space-conversation-content-width]")
		).toBeTruthy();

		view.unmount();
		renderSpaceConversationPanel({
			isCenterAgentDirectMessage: true,
			readOnly: false,
		});
		conversation = screen.getByRole("region", { name: "Space conversation" });
		conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});

		expect(
			conversation.hasAttribute("data-space-conversation-content-width")
		).toBe(false);
		expect(
			conversationLog.hasAttribute("data-space-conversation-content-width")
		).toBe(false);
		expect(
			conversationLog.querySelector("[data-space-conversation-content-width]")
		).toBeTruthy();
	});

	it("separates the main composer with spacing instead of a top divider", () => {
		renderSpaceConversationPanel({ readOnly: false });

		const composer = document.querySelector(
			'[data-slot="space-composer-section"]'
		);

		expect(composer).toBeInstanceOf(HTMLElement);
		expect(composer?.className).not.toContain("border-t");
		expect(composer?.className).not.toContain("border-border");
	});

	it("renders a Slack-style Center Agent intro before Center Agent DM messages", () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			automaticWakeConversationKind: "one_human_agent",
			centerAgentProfileId: TARGET_PROFILE_ID,
			hasEarlierHistory: false,
			isCenterAgentDirectMessage: true,
			membersSnapshot: createSpaceMembersSnapshot({
				agents: [
					{
						...createSpaceMemberAgentSnapshot({ profileId: TARGET_PROFILE_ID }),
						avatarStyle: "clover",
					},
				],
			}),
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					actorControllerDisplay: "Remote Agent",
					actorName: "Center Agent",
					actorProfileId: TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "signal-center-agent",
					text: "Hi Felix. I can help coordinate OpenMeld.",
				}),
			],
		});

		const introHeading = screen.getByRole("heading", {
			name: "What should we work on?",
		});
		const firstMessage = screen.getByText(
			"Hi Felix. I can help coordinate OpenMeld."
		);
		const centerAgentAvatar = screen.getByTestId(
			`space-center-agent-profile-avatar-${TARGET_PROFILE_ID}`
		);
		expect(
			centerAgentAvatar.querySelector("canvas[data-bot-avatar]")
		).toBeTruthy();
		const intro = introHeading.closest(
			"[data-center-agent-direct-message-intro]"
		);
		const introItem = intro?.closest('[data-slot="message-scroller-item"]');
		const firstMessageRow = firstMessage.closest("[data-slot='message']");

		expect(screen.queryByText("Remote")).toBeNull();
		expect(screen.queryByRole("img", { name: "Online" })).toBeNull();

		expect(intro).toBeTruthy();
		// The intro shows the Center Agent's own avatar, not the OpenMeld logo.
		expect(intro?.querySelector("canvas[data-bot-avatar]")).toBeTruthy();
		expect(introItem?.className).toContain("[content-visibility:visible]");
		expect(introItem?.className).not.toContain("[content-visibility:auto]");
		expect(intro?.className).not.toContain("px-3");
		expect(intro?.className).not.toContain("sm:px-8");
		expect(firstMessageRow?.className).toContain("px-0");
		expect(screen.getByText("What should we work on?")).toBeTruthy();
		expect(
			screen.queryByText('Not sure where to start? Try: "What can you do?"')
		).toBeNull();
		expect(
			screen.getByRole("button", {
				name: SHOW_ME_AROUND_BUTTON_NAME_PATTERN,
			})
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: CREATE_SPACE_BUTTON_NAME_PATTERN,
			})
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: CONNECT_MY_COMPUTER_BUTTON_NAME_PATTERN,
			})
		).toBeTruthy();
		expect(introHeading.compareDocumentPosition(firstMessage)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it("uses the saved Bot avatar for Center Agent messages in an ordinary Space", () => {
		renderSpaceConversationPanel({
			centerAgentProfileId: TARGET_PROFILE_ID,
			isCenterAgentDirectMessage: false,
			membersSnapshot: createSpaceMembersSnapshot({
				agents: [
					{
						...createSpaceMemberAgentSnapshot({ profileId: TARGET_PROFILE_ID }),
						avatarStyle: "clover",
					},
				],
			}),
			timelineItems: [
				createTimelineItem({
					actorAgentControllerRef: "builtin:codex",
					actorName: "Center Agent",
					actorProfileId: TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "signal-center-agent-in-space",
					text: "I can help in this Space too.",
				}),
			],
		});

		const avatar = screen.getByTestId(
			`space-center-agent-profile-avatar-${TARGET_PROFILE_ID}`
		);
		expect(avatar.querySelector("canvas[data-bot-avatar]")).toBeTruthy();
		expect(screen.queryByTestId("local-agent-logo-codex")).toBeNull();
	});

	it("uses the Center Agent DM intro instead of the generic empty state", () => {
		renderSpaceConversationPanel({
			automaticWakeConversationKind: "one_human_agent",
			isCenterAgentDirectMessage: true,
			timelineItems: [],
		});

		expect(
			screen.getByRole("heading", { name: "What should we work on?" })
		).toBeTruthy();
		expect(screen.queryByText("No messages yet")).toBeNull();
	});

	it("uses personal Center Agent copy in a personal workspace", () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			hasEarlierHistory: false,
			isCenterAgentDirectMessage: true,
			isPersonalContext: true,
			readOnly: false,
			timelineItems: [],
		});

		expect(screen.getByText("How should we work with your")).toBeTruthy();
		const starterActions = screen.getByRole("group", {
			name: "Suggested starting points",
		});
		expect(
			within(starterActions)
				.getAllByRole("button")
				.map((button) => button.textContent)
		).toEqual([
			"Connect my computerBring your local agents into OpenMeld.",
			"Create a SpaceTurn a goal into a Space with the right setup. Invite others and share it.",
			"Show me aroundLearn how OpenMeld works and what to do first.",
		]);
	});

	it("appends the starter prompt to the draft without sending", async () => {
		const onSendStarterPrompt = vi.fn().mockResolvedValue(undefined);
		const onComposerEditorChange = vi.fn();
		renderSpaceConversationPanel({
			composerText: "Keep my draft.",
			onComposerEditorChange,
			allowedActions: ["post_message"],
			hasEarlierHistory: false,
			isCenterAgentDirectMessage: true,
			onSendStarterPrompt,
			readOnly: false,
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: SHOW_ME_AROUND_BUTTON_NAME_PATTERN,
			})
		);

		await waitFor(() => {
			expect(onComposerEditorChange).toHaveBeenCalledWith(
				expect.objectContaining({
					text: "Keep my draft.\n\nI'm new to OpenMeld. Give me a short, plain-English tour, then recommend the best first step for me.",
				})
			);
			expect(onSendStarterPrompt).not.toHaveBeenCalled();
		});
	});

	it("opens setup without a hidden prompt or redundant continuation control", () => {
		const onSendStarterPrompt = vi.fn().mockResolvedValue(undefined);
		const view = renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			hasEarlierHistory: false,
			isCenterAgentDirectMessage: true,
			onSendStarterPrompt,
			readOnly: false,
			spaceId: "center-agent-dm-1",
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: CONNECT_MY_COMPUTER_BUTTON_NAME_PATTERN,
			})
		);

		const setup = view.container.querySelector(
			'[data-slot="computer-setup-flow"]'
		);
		expect(setup?.getAttribute("data-mode")).toBe("setup");
		expect(onSendStarterPrompt).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("button", { name: "Continue with Center Agent" })
		).toBeNull();
	});

	it("mounts only the latest trusted computer setup action inline", () => {
		const view = renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			hasEarlierHistory: false,
			isCenterAgentDirectMessage: true,
			readOnly: false,
			spaceId: "center-agent-dm-1",
			timelineItems: [
				createTimelineItem({
					actorName: "Center Agent",
					actorProfileId: "agent-profile-center",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					createdAtMs: Date.UTC(2026, 4, 27, 10),
					id: "setup-action-old",
					isAgentFinalReply: true,
					navigationAction: {
						label: "Connect this computer",
						target: { kind: "computer_setup", mode: "setup" },
						url: "http://localhost:5173/o/acme/connect",
					},
					text: "Connect this computer.",
				}),
				createTimelineItem({
					actorName: "Center Agent",
					actorProfileId: "agent-profile-center",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					createdAtMs: Date.UTC(2026, 4, 27, 11),
					id: "setup-action-current",
					isAgentFinalReply: true,
					navigationAction: {
						label: "Update OpenMeld Service",
						target: {
							connectedComputerId: "computer-1",
							kind: "computer_setup",
							mode: "update_service",
						},
						url: "http://localhost:5173/o/acme/connect?connectedComputerId=computer-1&serviceAction=update_service&session=fresh",
					},
					text: "Update OpenMeld Service.",
				}),
			],
		});

		expect(
			view.container.querySelectorAll('[data-slot="computer-setup-flow"]')
		).toHaveLength(1);
		expect(
			view.container
				.querySelector('[data-slot="computer-setup-flow"]')
				?.getAttribute("data-mode")
		).toBe("update_service");
		expect(
			screen
				.getByRole("link", { name: "Connect this computer" })
				.getAttribute("href")
		).toBe("http://localhost:5173/o/acme/connect");
	});

	it("keeps starter actions after the current user sends their first message", () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			hasEarlierHistory: false,
			isCenterAgentDirectMessage: true,
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					actorProfileId: "human-profile-1",
					actorProfileKind: "human",
					text: "My first message",
				}),
			],
		});

		expect(
			screen.queryByRole("group", { name: "Suggested starting points" })
		).toBeTruthy();
	});

	it("keeps starter actions while the user writes a draft", () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			composerText: "I already know what I want to ask",
			hasEarlierHistory: false,
			isCenterAgentDirectMessage: true,
			readOnly: false,
		});

		expect(
			screen.queryByRole("group", { name: "Suggested starting points" })
		).toBeTruthy();
	});

	it("does not offer starter actions when the Center Agent DM is read-only", () => {
		renderSpaceConversationPanel({
			allowedActions: ["post_message"],
			isCenterAgentDirectMessage: true,
			readOnly: true,
		});

		expect(
			screen.queryByRole("group", { name: "Suggested starting points" })
		).toBeNull();
	});

	it("does not render the Center Agent intro in ordinary agent DMs", () => {
		renderSpaceConversationPanel({
			automaticWakeConversationKind: "one_human_agent",
			isCenterAgentDirectMessage: false,
			timelineItems: [createTimelineItem({ text: "Ordinary agent DM" })],
		});

		expect(screen.queryByText("What should we work on?")).toBeNull();
		expect(
			screen.queryByText('Not sure where to start? Try: "What can you do?"')
		).toBeNull();
	});

	it("anchors the jump-to-latest control inside the message scroller", async () => {
		renderSpaceConversationPanel({
			timelineItems: [createTimelineItem({ text: "Earlier visible message" })],
		});

		const jumpButton = screen.getByRole("button", {
			name: "Jump to latest message",
		});
		expect(
			jumpButton.closest("[data-active]")?.getAttribute("data-active")
		).toBe("false");
		expect(!!jumpButton.closest("[inert]")).toBe(true);

		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		setElementScrollMetrics(conversationLog, {
			clientHeight: 300,
			scrollHeight: 1000,
			scrollTop: 100,
		});
		const scrollToMock = vi.fn((options: ScrollToOptions) => {
			conversationLog.scrollTop = Number(options.top);
		});
		Object.defineProperty(conversationLog, "scrollTo", {
			configurable: true,
			value: scrollToMock,
		});
		const messageItem = conversationLog.querySelector<HTMLElement>(
			"[data-message-id='signal-1']"
		);
		if (!messageItem) {
			throw new Error(
				"Expected a MessageScroller item for the visible message"
			);
		}
		vi.spyOn(messageItem, "getBoundingClientRect").mockImplementation(() =>
			createTestDomRect({ bottom: 900, height: 80, top: 820 })
		);
		fireEvent.wheel(conversationLog);
		fireEvent.scroll(conversationLog);

		await waitFor(() => {
			expect(
				jumpButton.closest("[data-active]")?.getAttribute("data-active")
			).toBe("true");
		});
		expect(!!jumpButton.closest("[inert]")).toBe(false);
		const messageScroller = jumpButton.closest(
			"[data-slot='message-scroller']"
		);

		expect(messageScroller).not.toBeNull();
		expect(messageScroller?.contains(jumpButton)).toBe(true);
		expect(
			jumpButton.closest("[data-slot='message-scroller-content']")
		).toBeNull();

		fireEvent.click(jumpButton);

		expect(scrollToMock).toHaveBeenCalledWith({
			behavior: "auto",
			top: 700,
		});
		await waitFor(() => {
			expect(
				jumpButton.closest("[data-active]")?.getAttribute("data-active")
			).toBe("false");
		});
	});

	it("lets an anchored public history view navigate to the real latest URL", () => {
		vi.stubGlobal("matchMedia", createMatchMediaMock(true));
		const latest = vi.fn();
		const signal = {
			...createThreadPreviewSignal(),
			data: { text: "Old anchored message" },
			id: "sig-old",
		};
		const historyNavigation = {
			activeWindow: {
				envelopes: [signal],
				confirmedAtLiveTail: false,
				hasAfter: true,
				hasBefore: true,
				identity: "space-123:public",
			},
			directory: {
				entries: [
					{
						author: "Felix",
						count: 30,
						endAt: 20,
						endSignalId: signal.id,
						preview: "Old anchored message",
						signalId: signal.id,
						startAt: 10,
					},
				],
				total: 240,
			},
			directoryError: false,
			directoryPending: false,
			earlierHref: "/spaces/space-123?signalId=sig-earlier",
			error: null,
			notice: null,
			errorDirection: undefined,
			hasHiddenLiveHistory: false,
			hrefForSignalId: (signalId: string) =>
				`/spaces/space-123?signalId=${signalId}`,
			latest,
			latestHref: "/spaces/space-123",
			loadAfter: vi.fn(async () => false),
			loadBefore: vi.fn(async () => false),
			open: vi.fn(async () => true),
			newerHref: "/spaces/space-123?signalId=sig-old",
			pending: false,
			pendingDirection: undefined,
			retry: vi.fn(),
			retryDirectory: vi.fn(),
			revealCachedBefore: vi.fn(),
			visibleLiveEnvelopes: [signal],
		} as NonNullable<SpaceConversationPanelInput["historyNavigation"]>;
		renderSpaceConversationPanel({
			historyNavigation,
			timelineItems: buildSpaceTimelineItems({
				envelopes: [signal],
				membersSnapshot: null,
			}),
		});

		const latestLink = screen.getByRole("button", {
			name: "Jump to latest message",
		});
		expect(latestLink.getAttribute("href")).toBe("/spaces/space-123");
		const click = new MouseEvent("click", {
			bubbles: true,
			button: 0,
			cancelable: true,
		});
		expect(latestLink.dispatchEvent(click)).toBe(true);
		expect(latest).not.toHaveBeenCalled();
		expect(document.querySelector(".space-history-tick")?.tagName).toBe("A");
		expect(screen.queryByText("Load newer messages")).toBeNull();
		const viewport = document.querySelector<HTMLElement>(
			'[aria-label="Conversation history"]'
		);
		expect(viewport).not.toBeNull();
		Object.defineProperties(viewport, {
			clientHeight: { configurable: true, value: 500 },
			scrollHeight: { configurable: true, value: 1000 },
		});
		if (viewport) {
			viewport.scrollTop = 300;
			fireEvent.scroll(viewport);
		}
		expect(historyNavigation.loadAfter).toHaveBeenCalledTimes(1);

		cleanup();
		renderSpaceConversationPanel({
			historyNavigation: {
				...historyNavigation,
				earlierHref: undefined,
				hrefForSignalId: undefined,
				latestHref: undefined,
				newerHref: undefined,
			},
			timelineItems: buildSpaceTimelineItems({
				envelopes: [signal],
				membersSnapshot: null,
			}),
		});
		expect(document.querySelector(".space-history-tick")?.tagName).toBe(
			"BUTTON"
		);
	});

	it("renders profile avatars and keeps message time outside the bubble", () => {
		const imageComplete = vi
			.spyOn(HTMLImageElement.prototype, "complete", "get")
			.mockReturnValue(true);
		const imageWidth = vi
			.spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
			.mockReturnValue(24);
		const createdAtMs = Date.UTC(2026, 4, 27, 10, 0, 7);
		const expectedTime = formatTestTime(createdAtMs);
		renderSpaceConversationPanel({
			selfAvatarImageUrl: "https://example.com/felix.png",
			timelineItems: [
				createTimelineItem({
					createdAtMs,
					text: "Self message",
				}),
			],
		});

		const messageBubble = screen
			.getByText("Self message")
			.closest("[data-signal-id]");
		const avatar = screen.getByTestId(
			"space-human-profile-avatar-human-profile-1"
		);
		const messageRow = messageBubble?.closest("[data-slot='message']");
		if (!(messageRow instanceof HTMLElement)) {
			throw new Error("Expected the profile name to render in a message row.");
		}
		const profileName = within(messageRow).getByText("Felix");

		expect(
			avatar.querySelector('[data-slot="avatar-image"]')?.getAttribute("src")
		).toBe("https://example.com/felix.png");
		expect(avatar.className).toContain("size-6");
		expect(avatar.className).toContain("after:border-0");
		expect(profileName.className).toContain("font-normal");
		expect(profileName.className).toContain("text-xs");
		expect(profileName.className).toContain("text-muted-foreground");
		expect(screen.getByText(expectedTime)).toBeTruthy();
		expect(messageBubble?.textContent).not.toContain(expectedTime);
		imageComplete.mockRestore();
		imageWidth.mockRestore();
	});

	it("only adds pending message status after sending takes eight seconds", () => {
		const createdAtMs = Date.UTC(2026, 4, 27, 10, 0, 7);
		vi.useFakeTimers();
		vi.setSystemTime(createdAtMs + 7000);

		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					createdAtMs,
					deliveryState: "pending",
					id: "pending:client-message-1",
					text: "Queued local message",
				}),
			],
		});

		expect(screen.queryByText("Sending...")).toBeNull();
		expect(
			document
				.querySelector('[data-signal-id="pending:client-message-1"]')
				?.hasAttribute("data-history-signal-id")
		).toBe(false);
		expect(
			document.querySelector("[data-space-message-delivery-status]")
		).toBeNull();
		expect(screen.queryByText(FAILED_TEXT_PATTERN)).toBeNull();

		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(screen.getByText("Still sending...")).toBeTruthy();
		expect(screen.queryByText(FAILED_TEXT_PATTERN)).toBeNull();
	});

	it("shows one starting Wake status in the Agent answer area", () => {
		const createdAtMs = Date.UTC(2026, 4, 27, 10, 0, 7);
		vi.useFakeTimers();
		vi.setSystemTime(createdAtMs + 7000);

		renderSpaceConversationPanel({
			ephemeralActivityItems: [
				createWakeProgressItem({
					phase: "sending",
					updatedAtMs: createdAtMs + 100,
				}),
			],
			timelineItems: [
				createTimelineItem({
					createdAtMs,
					deliveryState: "pending",
					id: "sig-source",
					text: "@runner please triage this",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		const wakeRow = screen.getByTestId("space-wake-thinking-row");
		const wakeIndicator = screen.getByTestId("space-wake-thinking-indicator");
		const wakeIcon = wakeIndicator.querySelector("canvas");

		expect(screen.queryByText("Sending...")).toBeNull();
		expect(wakeIndicator.textContent).toContain("Working…");
		expect(wakeIcon).toBeTruthy();
		expect(wakeIcon?.dataset.spaceAgentOrbState).toBe("solving");
		expect(
			wakeRow
				.closest("[data-message-id]")
				?.getAttribute("data-message-id")
				?.startsWith("active-wake:")
		).toBe(true);
		expect(wakeRow.getAttribute("data-align")).toBe("start");
		expect(wakeRow.getAttribute("data-slot")).toBe("space-wake-thinking-row");
		expect(wakeIndicator.className).toContain("gap-2");
		expect(wakeIndicator.className).not.toContain("pl-1");
	});

	it("keeps the Agent progress row stable while source delivery is delayed", () => {
		const createdAtMs = Date.UTC(2026, 4, 27, 10, 0, 7);
		vi.useFakeTimers();
		vi.setSystemTime(createdAtMs + 8000);

		renderSpaceConversationPanel({
			ephemeralActivityItems: [
				createWakeProgressItem({
					phase: "sending",
					sourceSignalId: "pending:client-message-1",
					updatedAtMs: createdAtMs + 100,
				}),
			],
			timelineItems: [
				createTimelineItem({
					createdAtMs,
					deliveryState: "pending",
					id: "sig-source",
					text: "@runner please triage this",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		expect(screen.queryByText("Still sending...")).toBeNull();
		expect(screen.queryByText("Starting Wake…")).toBeNull();
		expect(screen.getByTestId("space-wake-thinking-row").textContent).toContain(
			"Working… · 8s"
		);
	});

	it("keeps one stable Center Agent answer shell while its phase advances", () => {
		const createdAtMs = Date.UTC(2026, 4, 27, 10, 0, 7);
		vi.useFakeTimers();
		vi.setSystemTime(createdAtMs + 2000);
		const onWakeStopRequest = vi.fn();
		const membersSnapshot = createSpaceMembersSnapshot({
			agents: [
				createSpaceMemberAgentSnapshot({
					agentControllerRef: "hosted:center-agent",
					profileId: TARGET_PROFILE_ID,
					profileName: "Center Agent",
				}),
			],
		});

		const view = renderSpaceConversationPanel({
			ephemeralActivityItems: [
				createWakeProgressItem({
					phase: "sending",
					updatedAtMs: createdAtMs + 100,
				}),
			],
			isCenterAgentDirectMessage: true,
			membersSnapshot,
			onWakeStopRequest,
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					createdAtMs,
					deliveryState: "pending",
					id: "pending:client-message-1",
					text: "Help me prepare the weekly update.",
					wakeClientMessageId: "client-message-1",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		const optimisticReply = document.querySelector<HTMLElement>(
			'[data-message-id^="active-wake:"]'
		);
		if (!optimisticReply) {
			throw new Error("Expected the optimistic Center Agent reply shell.");
		}
		const progressRow = within(optimisticReply).getByTestId(
			"space-wake-thinking-row"
		);
		const controlSlot = within(optimisticReply).getByTestId(
			"space-message-progress-control-slot"
		);
		const progressInset = progressRow.closest(
			'[data-slot="space-message-row-progress-inset"]'
		);
		const answerSurface = progressRow.closest('[data-slot="bubble-content"]');

		expect(within(optimisticReply).getByText("Center Agent")).toBeTruthy();
		expect(
			within(progressRow).getByRole("status", {
				name: "Working… · 2s",
			}).textContent
		).toContain("Working…");
		expect(
			progressRow.querySelector('[data-space-agent-orb-state="solving"]')
		).toBeTruthy();
		expect(progressInset).toBeNull();
		expect(
			answerSurface?.querySelector('[data-slot="space-message-body"]')
		).toBeNull();
		expect(
			within(controlSlot).getByRole("button", { name: "Stop @runner" })
		).toBeTruthy();
		expect(screen.queryByText("Sending to Agent…")).toBeNull();

		view.rerender(
			<SpaceConversationPanel
				{...createSpaceConversationPanelProps({
					ephemeralActivityItems: [
						createWakeProgressItem({
							phase: "sending",
							sourceSignalId: "pending:client-message-1",
							updatedAtMs: createdAtMs + 500,
						}),
					],
					isCenterAgentDirectMessage: true,
					membersSnapshot,
					onWakeStopRequest,
					readOnly: false,
					timelineItems: [
						createTimelineItem({
							clientMessageId: "client-message-1",
							createdAtMs,
							id: "sig-source",
							text: "Help me prepare the weekly update.",
						}),
					],
				})}
			/>
		);

		const persistedSendingReply = document.querySelector<HTMLElement>(
			'[data-message-id^="active-wake:"]'
		);
		expect(persistedSendingReply).toBe(optimisticReply);
		expect(
			within(persistedSendingReply as HTMLElement).getByRole("status", {
				name: "Working… · 2s",
			}).textContent
		).toContain("Working…");

		view.rerender(
			<SpaceConversationPanel
				{...createSpaceConversationPanelProps({
					ephemeralActivityItems: [
						createWakeProgressItem({
							phase: "running",
							updatedAtMs: createdAtMs + 1000,
						}),
					],
					isCenterAgentDirectMessage: true,
					membersSnapshot,
					onWakeStopRequest,
					readOnly: false,
					timelineItems: [
						createTimelineItem({
							createdAtMs,
							id: "sig-source",
							text: "Help me prepare the weekly update.",
							wakeClientMessageId: "client-message-1",
							wakeSourceSignalId: "sig-source",
							wakeTargetProfileIds: [TARGET_PROFILE_ID],
						}),
					],
				})}
			/>
		);

		const updatedOptimisticReply = document.querySelector<HTMLElement>(
			'[data-message-id^="active-wake:"]'
		);
		expect(updatedOptimisticReply).toBe(optimisticReply);
		expect(
			updatedOptimisticReply?.querySelector("[data-history-signal-id]")
		).toBeNull();
		expect(
			within(updatedOptimisticReply as HTMLElement).getByTestId(
				"space-message-progress-control-slot"
			)
		).toBe(controlSlot);
		expect(
			within(updatedOptimisticReply as HTMLElement).getByRole("status", {
				name: RUNNER_WORKING_NAME_PATTERN,
			}).textContent
		).toContain("Working…");
		expect(
			within(updatedOptimisticReply as HTMLElement).getByRole("button", {
				name: "Stop @runner",
			})
		).toBeTruthy();
		expect(screen.queryByText("Sending to Agent…")).toBeNull();
	});

	it("advances the Center Agent answer shell from polled Wake progress", () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 4, 27, 10, 0, 22));
		renderSpaceConversationPanel({
			isCenterAgentDirectMessage: true,
			membersSnapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						agentControllerRef: "hosted:center-agent",
						profileId: TARGET_PROFILE_ID,
						profileName: "Center Agent",
					}),
				],
			}),
			ephemeralActivityItems: [
				createWakeProgressItem({
					phase: "running",
					updatedAtMs: Date.UTC(2026, 4, 27, 10, 0, 21),
				}),
			],
			timelineItems: [
				createTimelineItem({
					createdAtMs: Date.UTC(2026, 4, 27, 10, 0, 7),
					id: "sig-source",
					text: "Help me prepare the weekly update.",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		const optimisticReply = document.querySelector<HTMLElement>(
			'[data-message-id^="active-wake:"]'
		);
		if (!optimisticReply) {
			throw new Error("Expected polling to create the optimistic reply shell.");
		}
		expect(
			within(optimisticReply).getByRole("status", {
				name: RUNNER_WORKING_NAME_PATTERN,
			}).textContent
		).toContain("Working…");
	});

	it.each([
		["Center Agent", "hosted:center-agent"],
		["Remote Agent", "hosted:remote-agent"],
		["Local Agent", "codex"],
	] as const)("puts completed %s work before its durable reply", (name, controller) => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorAgentControllerRef: controller,
					actorName: name,
					actorProfileId: TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					actorProfileName: name,
					agentActivity: {
						v: 1,
						steps: [
							{
								toolName: "openmeld_read_space_context",
								state: "output-available",
								work: {
									v: 1,
									key: "space.context.read",
								},
							},
						],
						truncated: false,
					},
					id: "sig-agent-final",
					text: "Here is the Space summary.",
				}),
			],
		});

		const activityTriggers = screen.getAllByRole("button", {
			name: "Work summary: Reviewed Space context",
		});
		expect(activityTriggers).toHaveLength(1);
		expect(activityTriggers[0]?.getAttribute("aria-expanded")).toBe("false");

		const bubbleContent = screen
			.getByText("Here is the Space summary.")
			.closest("[data-slot='space-message-text-surface']");
		expect(bubbleContent?.contains(activityTriggers[0] ?? null)).toBe(true);
		const answerElement = screen.getByText("Here is the Space summary.");
		const directChildren = Array.from(bubbleContent?.children ?? []);
		const answerSection = directChildren.find((child) =>
			child.contains(answerElement)
		);
		const activitySection = directChildren.find((child) =>
			child.contains(activityTriggers[0] ?? null)
		);
		expect(directChildren.indexOf(activitySection as Element)).toBeLessThan(
			directChildren.indexOf(answerSection as Element)
		);
	});

	it("uses the same active answer area in an ordinary Space", () => {
		renderSpaceConversationPanel({
			ephemeralActivityItems: [createWakeProgressItem()],
			membersSnapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						profileId: TARGET_PROFILE_ID,
						profileName: "Center Agent",
					}),
				],
			}),
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		expect(
			document.querySelector('[data-message-id^="active-wake:"]')
		).not.toBeNull();
	});

	it("keeps a selected thread Wake's status and Stop on the Open thread entrance", () => {
		const progress = {
			...createWakeProgressItem(),
			targetLabel: "Center Agent",
		};
		const agentStreams = [
			{
				createdAtMs: progress.startedAtMs ?? 0,
				dispatchId: "dispatch-1",
				observedRevision: 1,
				profileId: TARGET_PROFILE_ID,
				reasonCode: null,
				replyThreadRootSignalId: "sig-source",
				sequence: 1,
				spaceId: "space-1",
				status: "streaming" as const,
				streamId: "stream-1",
				text: "",
				textSequence: 0,
				triggerMessageId: "sig-source",
				updatedAtMs: progress.updatedAtMs,
			},
		];
		const props = createSpaceConversationPanelProps({
			agentStreams,
			centerAgentProfileId: TARGET_PROFILE_ID,
			membersSnapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						profileId: TARGET_PROFILE_ID,
						profileName: "Center Agent",
					}),
				],
			}),
			ephemeralActivityItems: [progress],
			onWakeStopRequest: vi.fn(),
			readOnly: false,
			threads: [
				{
					createdAt: "2026-04-11T00:00:00.000Z",
					createdByProfileId: "human-profile-1",
					rootSignalId: "sig-source",
					spaceId: "space-1",
					threadId: "thread-1",
					updatedAt: "2026-04-11T00:00:00.000Z",
				},
			],
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "@Center Agent please investigate",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});
		const view = render(
			<SpaceConversationPanel {...props} agentStreams={[]} />
		);

		const source = document.querySelector("[data-message-row-id='sig-source']");
		expect(source).not.toBeNull();
		expect(
			within(source as HTMLElement).queryByLabelText("Center Agent · Working…")
		).toBeNull();
		expect(
			document.querySelector('[data-message-id^="active-wake:"]')
		).not.toBeNull();

		view.rerender(
			<SpaceConversationPanel
				{...props}
				agentStreams={agentStreams.map((stream) => ({
					...stream,
					replyThreadRootSignalId: null,
				}))}
			/>
		);
		expect(
			document.querySelector('[data-message-id^="active-wake:"]')
		).not.toBeNull();
		expect(
			within(source as HTMLElement).queryByLabelText("Center Agent · Working…")
		).toBeNull();

		view.rerender(<SpaceConversationPanel {...props} />);
		const status = within(source as HTMLElement).getByLabelText(
			"Center Agent · Working…"
		);
		const entrance = status.parentElement;
		expect(entrance).not.toBeNull();
		expect(
			within(entrance as HTMLElement).getByRole("button", {
				name: "Open thread",
			})
		).toBeTruthy();
		expect(
			within(entrance as HTMLElement).getByRole("button", {
				name: "Stop Center Agent",
			})
		).toBeTruthy();
		expect(
			(source as HTMLElement).querySelector(
				'[data-slot="space-wake-thinking-row"]'
			)
		).toBeNull();
		expect(
			document.querySelector('[data-message-id^="active-wake:"]')
		).toBeNull();

		// Stream-first, progress-first, and focused history use one status row.
		view.rerender(
			<SpaceConversationPanel {...props} ephemeralActivityItems={[]} />
		);
		expect(
			within(source as HTMLElement).getByLabelText("Center Agent · Working…")
		).toBe(status);
		expect(
			within(source as HTMLElement).queryByRole("button", {
				name: "Stop Center Agent",
			})
		).toBeNull();
		expect(screen.queryByText("· Reply in progress")).toBeNull();
		view.rerender(
			<SpaceConversationPanel
				{...props}
				agentStreams={[]}
				ephemeralActivityItems={[
					{ ...progress, replyThreadRootSignalId: "sig-source" },
				]}
				historyNavigation={{
					activeWindow: {
						identity: "space-1:human-profile-1",
						envelopes: [],
						confirmedAtLiveTail: false,
						hasBefore: false,
						hasAfter: true,
					},
					directory: undefined,
					directoryError: false,
					directoryPending: false,
					error: null,
					notice: null,
					errorDirection: undefined,
					hasHiddenLiveHistory: false,
					latest: vi.fn(),
					loadAfter: vi.fn(async () => false),
					loadBefore: vi.fn(async () => false),
					open: vi.fn(async () => true),
					hrefForSignalId: undefined,
					earlierHref: undefined,
					latestHref: undefined,
					newerHref: undefined,
					pending: true,
					pendingDirection: "before",
					retry: vi.fn(),
					retryDirectory: vi.fn(),
					revealCachedBefore: vi.fn(),
					visibleLiveEnvelopes: [],
				}}
				viewState={{ ...props.viewState, isLoadingEarlierHistory: true }}
			/>
		);
		expect(
			within(source as HTMLElement).getByLabelText("Center Agent · Working…")
		).toBe(status);
		expect(
			within(source as HTMLElement).getByRole("button", {
				name: "Stop Center Agent",
			})
		).toBeTruthy();
		view.rerender(
			<SpaceConversationPanel
				{...props}
				ephemeralActivityItems={[
					{ ...progress, phase: "stopped", terminal: true },
				]}
			/>
		);
		expect(
			within(source as HTMLElement).queryByLabelText("Center Agent · Working…")
		).toBeNull();
		expect(
			within(source as HTMLElement).queryByRole("button", {
				name: "Stop Center Agent",
			})
		).toBeNull();

		const finalReply = {
			...createThreadPreviewSignal(),
			data: {
				meta: { dispatchId: "dispatch-1", purpose: "agent_reply_final" },
				text: "Here is the answer.",
			},
			profile: {
				kind: "agent" as const,
				profileId: TARGET_PROFILE_ID,
				profileName: "Center Agent",
			},
		};
		view.rerender(
			<SpaceConversationPanel
				{...props}
				threadPreviews={[
					{
						placements: [],
						replyCount: 1,
						signals: [finalReply],
						threadId: "thread-1",
					},
				]}
			/>
		);
		expect(
			within(source as HTMLElement).getByText("Here is the answer.")
		).toBeTruthy();
		expect(
			within(source as HTMLElement).queryByLabelText("Center Agent · Working…")
		).toBeNull();
		expect(
			within(source as HTMLElement).queryByRole("button", {
				name: "Stop Center Agent",
			})
		).toBeNull();
	});

	it("shows an existing thread's progress before a reply destination is selected", () => {
		const thread = createThread();
		renderSpaceConversationPanel({
			centerAgentProfileId: TARGET_PROFILE_ID,
			ephemeralActivityItems: [
				{
					...createWakeProgressItem({ sourceSignalId: "thread-question" }),
					targetLabel: "Center Agent",
					sourceContext: {
						messagePreview: "Please investigate",
						profileId: "human-profile-1",
						profileKind: "human",
						profileName: "Human",
						threadId: thread.threadId,
					},
				},
			],
			threads: [thread],
			timelineItems: [
				createTimelineItem({
					id: thread.rootSignalId,
					text: "Existing discussion",
				}),
			],
		});
		const source = screen
			.getByText("Existing discussion")
			.closest("[data-message-row-id='sig-root']");
		expect(source).not.toBeNull();
		expect(
			within(source as HTMLElement).getByLabelText("Center Agent · Working…")
		).toBeTruthy();
		expect(
			document.querySelector('[data-message-id^="active-wake:"]')
		).toBeNull();
	});

	it("shows the live reply at its source while the Center Agent destination is undecided", () => {
		const progress = createWakeProgressItem();
		const streamId = "stream-undecided";
		renderSpaceConversationPanel({
			agentStreams: [
				{
					createdAtMs: progress.startedAtMs ?? 0,
					dispatchId: "dispatch-1",
					observedRevision: 1,
					profileId: TARGET_PROFILE_ID,
					reasonCode: null,
					sequence: 1,
					spaceId: "space-1",
					status: "streaming",
					streamId,
					text: "",
					textSequence: 0,
					triggerMessageId: "sig-source",
					updatedAtMs: progress.updatedAtMs,
				},
			],
			centerAgentProfileId: TARGET_PROFILE_ID,
			ephemeralActivityItems: [progress],
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "Please investigate",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
				createTimelineItem({
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId,
						toolParts: [
							{
								type: "tool",
								toolCallId: "tool-undecided",
								toolName: "agent_read_files",
								state: "input-available",
								work: { key: "source.read", v: 1 },
							},
						],
					},
					actorProfileId: TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					id: streamId,
					isAgentFinalReply: true,
					replyToSignalId: "sig-source",
					text: "",
				}),
			],
		});

		expect(screen.getByText("Please investigate")).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "Working…. Work summary: Reviewing source files…",
			})
		).toBeTruthy();
		expect(
			document.querySelector(`[data-message-id="${streamId}"]`)
		).not.toBeNull();
		expect(
			document.querySelector('[data-message-id^="active-wake:"]')
		).toBeNull();
	});

	it("replaces the optimistic Center Agent reply shell with the first real stream projection", () => {
		renderSpaceConversationPanel({
			ephemeralActivityItems: [
				createWakeProgressItem({ updatedAtMs: Date.now() }),
			],
			isCenterAgentDirectMessage: true,
			membersSnapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						agentControllerRef: "hosted:center-agent",
						profileId: TARGET_PROFILE_ID,
						profileName: "Center Agent",
					}),
				],
			}),
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "Help me prepare the weekly update.",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
				createTimelineItem({
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId: "stream:submission-1",
					},
					actorName: "Center Agent",
					actorProfileId: TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "stream:submission-1",
					isAgentFinalReply: true,
					replyToSignalId: "sig-source",
					text: "",
				}),
			],
		});

		expect(
			document.querySelector('[data-message-id^="active-wake:"]')
		).toBeNull();
		expect(
			screen.getByRole("status", { name: RUNNER_WORKING_NAME_PATTERN })
		).toBeTruthy();
	});

	it.each([
		false,
		true,
	])("keeps the same answer DOM row when a Local Agent finishes (DM=%s)", (isDirectMessage) => {
		const streaming = createTimelineItem({
			id: "stream:local-agent",
			wakeDispatchId: "dispatch-1",
			actorProfileKind: "agent",
			actorProfileId: TARGET_PROFILE_ID,
			actorName: "Runner",
			text: "",
			agentStreamState: {
				reasonCode: null,
				sequence: 1,
				status: "streaming",
				streamId: "local-agent:10:dispatch-1:9:attempt-1",
			},
		});
		const rendered = renderSpaceConversationPanel({
			isDirectMessage,
			timelineItems: [streaming],
		});
		const row = screen
			.getByRole("status", { name: "Working…" })
			.closest("[data-message-id]");
		expect(row).not.toBeNull();
		rendered.rerender(
			<SpaceConversationPanel
				{...createSpaceConversationPanelProps({
					isDirectMessage,
					timelineItems: [
						{
							...streaming,
							id: "durable-final",
							text: "Ready to review.",
							agentStreamState: undefined,
							isAgentFinalReply: true,
						},
					],
				})}
			/>
		);
		expect(screen.queryByRole("status", { name: "Working…" })).toBeNull();
		expect(
			screen.getByText("Ready to review.").closest("[data-message-id]")
		).toBe(row);
		expect(row?.getAttribute("data-message-id")).toBe("durable-final");
	});

	it("aligns an empty local Agent working row with the profile name and separates it from the header", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorAgentControllerRef: "codex",
					actorName: "China Deploy Research Codex",
					actorProfileId: "agt_local_codex",
					actorProfileKind: "agent",
					actorProfileName: "China Deploy Research Codex",
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId: "local-agent:dispatch-1:attempt-1",
					},
					id: "stream:local-codex",
					text: "",
				}),
			],
		});

		const progressRow = screen.getByRole("status", {
			name: "Working…",
		});
		const progressInset = progressRow.closest(
			'[data-slot="space-message-row-progress-inset"]'
		);
		const bubbleContent = progressRow.closest('[data-slot="bubble-content"]');
		const messageRow = progressRow.closest("[data-message-row-id]");
		const footer = messageRow?.querySelector('[data-slot="message-footer"]');

		expect(progressInset).toBeNull();
		expect(bubbleContent).not.toBeNull();
		expect(bubbleContent?.contains(progressRow)).toBe(true);
		expect(footer).not.toBeNull();
		expect(progressRow.compareDocumentPosition(footer as Node)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(
			progressRow
				.closest('[data-slot="message"]')
				?.querySelector('[data-slot="space-message-body"]') ?? null
		).toBeNull();
		expect(screen.getByText("Working…")).toBeTruthy();
	});

	it("does not leave an optimistic shell behind when the final Center Agent reply arrives first", () => {
		renderSpaceConversationPanel({
			ephemeralActivityItems: [createWakeProgressItem()],
			isCenterAgentDirectMessage: true,
			membersSnapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						profileId: TARGET_PROFILE_ID,
						profileName: "Center Agent",
					}),
				],
			}),
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
				createTimelineItem({
					actorName: "Center Agent",
					actorProfileId: TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "sig-final-reply",
					isAgentFinalReply: true,
					replyToSignalId: "sig-source",
					text: "Here is the weekly update.",
				}),
			],
		});

		expect(
			document.querySelector('[data-message-id^="active-wake:"]')
		).toBeNull();
		expect(screen.getByText("Here is the weekly update.")).toBeTruthy();
	});

	it("keeps the Center Agent working state while partial reply text is visible", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					agentStreamState: {
						reasonCode: null,
						sequence: 3,
						status: "streaming",
						streamId: "stream:submission-1",
					},
					actorName: "Center Agent",
					actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "stream:submission-1",
					isAgentFinalReply: true,
					text: "I am working through the request",
				}),
			],
		});

		const messageBubble = document.querySelector(
			'[data-signal-id="stream:submission-1"]'
		);
		const progressRow = screen.getByRole("status", {
			name: "Working…",
		});
		const progressInset = progressRow.closest(
			'[data-slot="space-message-row-progress-inset"]'
		);
		expect(messageBubble?.textContent).toContain(
			"I am working through the request"
		);
		expect(progressInset).toBeNull();
		expect(screen.getByText("Working…")).toBeTruthy();
		expect(messageBubble?.getAttribute("data-signal-id")).toBe(
			"stream:submission-1"
		);
		expect(messageBubble?.hasAttribute("data-history-signal-id")).toBe(false);
	});

	it.each([
		"failed",
		"stopped",
		"completed_but_publish_failed",
	] as const)("does not use an unpublished %s reply as a history anchor", (status) => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					id: "stream:unpublished-reply",
					text: "Partial reply retained for diagnosis",
					agentStreamState: {
						streamId: "stream:unpublished-reply",
						sequence: 3,
						status,
						reasonCode: null,
					},
				}),
			],
		});
		const reply = document.querySelector(
			'[data-signal-id="stream:unpublished-reply"]'
		);
		expect(reply).not.toBeNull();
		expect(reply?.hasAttribute("data-history-signal-id")).toBe(false);
	});

	it("does not render an empty progress inset for a completed reply", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorName: "Center Agent",
					actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "signal:completed-reply",
					isAgentFinalReply: true,
					text: "The request is complete.",
				}),
			],
		});

		expect(
			document.querySelector('[data-slot="space-message-row-progress-inset"]')
		).toBeNull();
		expect(
			document
				.querySelector('[data-signal-id="signal:completed-reply"]')
				?.getAttribute("data-history-signal-id")
		).toBe("signal:completed-reply");
	});

	it("opens the durable source message details from live Agent work", () => {
		useQueryMock.mockImplementation(
			(options: { queryKey: readonly unknown[] }) =>
				options.queryKey[3] === "sig-source"
					? {
							data: createMinimalMessageDetailsResponse(),
							isError: false,
							isPending: false,
						}
					: {
							data: undefined,
							isError: true,
							isPending: false,
						}
		);
		renderSpaceConversationPanel({
			readOnly: false,
			spaceId: "space-1",
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "Please investigate this.",
				}),
				createTimelineItem({
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId: "stream:submission-1",
						toolParts: [
							{
								state: "input-available",
								toolCallId: "tool-call-1",
								toolName: "agent_read_files",
								type: "tool",
								work: { key: "source.read", v: 1 },
							},
						],
					},
					actorName: "Center Agent",
					actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "stream:submission-1",
					isAgentFinalReply: true,
					replyToSignalId: "sig-source",
					text: " \n ",
				}),
			],
		});

		expect(screen.getByText("Working…")).toBeTruthy();
		const activityTrigger = screen.getByRole("button", {
			name: "Working…. Work summary: Reviewing source files…",
		});
		expect(activityTrigger.getAttribute("aria-expanded")).toBe("true");
		const progressRow = activityTrigger.closest(
			'[data-slot="space-message-progress-row"]'
		);
		const bubbleContent = activityTrigger.closest(
			'[data-slot="bubble-content"]'
		);
		expect(progressRow).not.toBeNull();
		expect(bubbleContent?.contains(progressRow)).toBe(true);
		fireEvent.click(
			within(
				bubbleContent?.closest("[data-message-row-id]") as HTMLElement
			).getByRole("button", { name: "More actions" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Message details" }));
		expect(
			screen.getByRole("dialog", { name: "Message details" })
		).toBeTruthy();
		expect(screen.queryByText("Couldn't load message details.")).toBeNull();
	});

	it.each([
		["failed", "Center Agent could not complete this reply.", "Reply failed"],
		["stopped", "Center Agent stopped this reply.", "(Request stopped)"],
		[
			"completed_but_publish_failed",
			"Center Agent finished, but OpenMeld could not publish the reply.",
			"Reply could not be posted",
		],
	] as const)("replaces partial text with the %s terminal notice in the same bubble", (status, noticeText, statusText) => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					agentStreamState: {
						reasonCode: "remote_agent.test",
						sequence: 3,
						status,
						streamId: "stream:submission-1",
					},
					actorName: "Center Agent",
					actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "stream:submission-1",
					isAgentFinalReply: true,
					text: noticeText,
				}),
			],
		});

		expect(screen.getByText(noticeText)).toBeTruthy();
		expect(screen.getByText(statusText)).toBeTruthy();
	});

	it("renders terminal system notice text directly via the outcome row, with a Message details action", () => {
		renderSpaceConversationPanel({
			readOnly: false,
			spaceId: "space-123",
			timelineItems: [
				createTimelineItem({
					actorName: "OpenMeld",
					actorProfileId: "system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld",
					id: "signal-terminal-failure",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-1",
					systemNoticeReason: "reply.publication_failed",
					systemNoticeType: "terminal_failure",
					text: "OpenMeld could not post the reply.",
				}),
			],
		});

		expect(screen.getByText("OpenMeld could not post the reply.")).toBeTruthy();
		expect(
			screen.queryByText(
				"Agent finished, but OpenMeld could not post the reply."
			)
		).toBeNull();
		expect(
			screen.queryByText("OpenMeld could not complete this request.")
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Open diagnostics" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: RETRY_BUTTON_NAME_PATTERN })
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "Open message details" })
		).toBeTruthy();
	});

	it.each([
		false,
		true,
	])("shows the failure explanation to a read-only viewer (anchored: %s)", (anchored) => {
		renderSpaceConversationPanel({
			readOnly: true,
			timelineItems: [
				...(anchored
					? [
							createTimelineItem({
								id: "readonly-wake",
								text: "Please review the release.",
							}),
						]
					: []),
				createTimelineItem({
					actorName: "OpenMeld",
					actorProfileId: "system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld",
					id: "signal-terminal-failure",
					replyToSignalId: anchored ? "readonly-wake" : null,
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					text: "OpenMeld could not post the reply.",
				}),
			],
		});

		expect(screen.getByText("OpenMeld could not post the reply.")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Open message details" })
		).toBeNull();
	});

	it("indents the unanchored outcome row to match the message content column instead of sitting flush against the edge", () => {
		renderSpaceConversationPanel({
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					actorName: "OpenMeld",
					actorProfileId: "system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld",
					id: "signal-terminal-failure",
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					text: "OpenMeld could not post the reply.",
				}),
			],
		});

		const row = screen
			.getByText("OpenMeld could not post the reply.")
			.closest("[data-signal-id='signal-terminal-failure']");
		expect(row?.className).toContain("px-0");
		expect(row?.className).toContain("py-2");
	});

	it("shows Stopped with the Agent's partial reply instead of a separate notice", () => {
		renderSpaceConversationPanel({
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					actorName: "Runner",
					actorProfileId: "agent-runner",
					actorProfileKind: "agent",
					actorProfileName: "Runner",
					id: "signal-wake-stopped",
					signalType: "signal.system_notice",
					systemNoticeType: "wake_stopped",
					text: "Here is the first finding.",
				}),
			],
		});

		const reply = screen
			.getByText("Here is the first finding.")
			.closest("[data-message-row-id='signal-wake-stopped']") as HTMLElement;
		expect(reply).not.toBeNull();
		expect(within(reply).getByText("(Request stopped)")).toBeTruthy();
		expect(reply.querySelector("[data-slot='marker']")).toBeNull();
	});

	it("moves an anchored failure into the source message footer and keeps a past-tense outcome in Details", () => {
		const detailedFailure =
			"OpenMeld could not reach Codex 5.6 Sol on this computer for this Wake. Reconnect the computer, then try again.";
		renderSpaceConversationPanel({
			membersSnapshot: createWakeReceiptMembersSnapshot(),
			readOnly: false,
			spaceId: "space-123",
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Runner(wake) please investigate",
				}),
				createTimelineItem({
					actorName: "OpenMeld",
					actorProfileId: "system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld",
					createdAtMs: Date.UTC(2026, 4, 27, 10, 1),
					id: "sig-failure",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "terminal_failure",
					text: detailedFailure,
				}),
			],
		});

		const sourceMessage = screen
			.getByText("@Runner(wake) please investigate")
			.closest("[data-message-row-id='sig-wake']");
		expect(sourceMessage).not.toBeNull();
		expect(sourceMessage?.getAttribute("data-message-source-at")).toBe(
			String(createTimelineItem().createdAtMs)
		);
		const footer = sourceMessage?.querySelector(
			"[data-slot='message-footer']"
		) as HTMLElement;
		expect(
			within(footer).queryByText("Codex 5.6 Sol couldn’t reply")
		).toBeNull();
		expect(
			within(sourceMessage as HTMLElement).queryByText(detailedFailure)
		).toBeNull();
		expect(
			within(sourceMessage as HTMLElement).queryByTestId("space-outcome-row")
		).toBeNull();
		const details = within(footer).getByRole("button", {
			name: "View error details: Codex 5.6 Sol couldn’t reply",
		});
		expect(details.className).toContain("text-destructive");
		fireEvent.click(details);
		expect(
			screen.getByRole("dialog", { name: "Message details" })
		).toBeTruthy();
		expect(screen.getByText(detailedFailure)).toBeTruthy();
		expect(
			screen.queryByText("Codex 5.6 Sol could not complete this Wake.")
		).toBeNull();
	});

	it("does not execute a fresh Wake through Message details recovery", async () => {
		const onRecoverExecution = vi.fn<SpaceExecutionRecoveryHandler>(
			async (attempt) =>
				attempt.action === null
					? {
							action: "retry_as_new_execution",
							label: "Retry as new execution",
							status: "available",
							warning:
								"This starts a new execution and may run the task and its side effects again.",
						}
					: {
							action: null,
							label: null,
							status: "in_progress",
							warning: null,
						}
		);
		renderSpaceConversationPanel({
			onRecoverExecution,
			readOnly: false,
			spaceId: "space-123",
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Center Agent(wake) review the pull request",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
				createTimelineItem({
					actorProfileId: "system",
					actorProfileKind: "system",
					id: "sig-failure",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeDispatchId: "dispatch-1",
					systemNoticeFailureStage: "execution",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "terminal_failure",
					text: "Center Agent could not complete this Wake.",
				}),
			],
		});

		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", {
				name: "View error details: Agent couldn’t reply",
			})
		);
		await screen.findByRole("dialog", { name: "Message details" });
		await waitFor(() => expect(onRecoverExecution).toHaveBeenCalledOnce());
		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
	});

	it("summarizes multiple anchored failures in one stable footer", () => {
		renderSpaceConversationPanel({
			membersSnapshot: createWakeReceiptMembersSnapshot(),
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Codex(wake) @Claude(wake) please investigate",
				}),
				createTimelineItem({
					actorProfileId: "system",
					actorProfileKind: "system",
					id: "sig-failure-codex",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "terminal_failure",
					text: "Codex could not reply.",
				}),
				createTimelineItem({
					actorProfileId: "system",
					actorProfileKind: "system",
					id: "sig-failure-claude",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: SECOND_TARGET_PROFILE_ID,
					systemNoticeType: "terminal_failure",
					text: "Claude could not reply.",
				}),
			],
		});

		expect(
			screen.getByRole("button", {
				name: "View error details: 2 agents couldn’t reply",
			})
		).toBeTruthy();
		expect(screen.queryByText("2 agents couldn’t reply")).toBeNull();
		expect(screen.queryByTestId("space-outcome-row")).toBeNull();
		expect(screen.queryByText("Codex 5.6 Sol couldn’t reply")).toBeNull();
		expect(screen.queryByText("Claude Opus 4.8 couldn’t reply")).toBeNull();
	});

	it("keeps a stopped target as a muted outcome while a failed target uses the footer", () => {
		renderSpaceConversationPanel({
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Codex(wake) @Claude(wake) please investigate",
				}),
				createTimelineItem({
					actorProfileId: "system",
					actorProfileKind: "system",
					id: "sig-failure-codex",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "terminal_failure",
					text: "Codex could not reply.",
				}),
				createTimelineItem({
					actorProfileId: "system",
					actorProfileKind: "system",
					id: "sig-stopped-claude",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: SECOND_TARGET_PROFILE_ID,
					systemNoticeType: "wake_stopped",
					text: "Claude was stopped by the user.",
				}),
			],
		});

		expect(
			screen.getByRole("button", {
				name: "View error details: Agent couldn’t reply",
			})
		).toBeTruthy();
		expect(screen.getByText("Claude was stopped by the user.")).toBeTruthy();
		expect(screen.getAllByTestId("space-outcome-row")).toHaveLength(1);
		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
	});

	it("keeps stopped outcomes attached to their individual Agents", () => {
		renderSpaceConversationPanel({
			membersSnapshot: createWakeReceiptMembersSnapshot(),
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Codex(wake) @Claude(wake) please investigate",
				}),
				createTimelineItem({
					actorName: "Codex 5.6 Sol",
					actorProfileId: TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					actorProfileName: "Codex 5.6 Sol",
					createdAtMs: Date.UTC(2026, 4, 27, 10, 1),
					id: "sig-stopped-codex",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: TARGET_PROFILE_ID,
					systemNoticeType: "wake_stopped",
					text: "",
				}),
				createTimelineItem({
					actorName: "Claude Opus 4.8",
					actorProfileId: SECOND_TARGET_PROFILE_ID,
					actorProfileKind: "agent",
					actorProfileName: "Claude Opus 4.8",
					createdAtMs: Date.UTC(2026, 4, 27, 10, 1),
					id: "sig-stopped-claude",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeTargetProfileId: SECOND_TARGET_PROFILE_ID,
					systemNoticeType: "wake_stopped",
					text: "Partial research",
				}),
			],
		});

		const stopped = screen.getAllByText("(Request stopped)");
		expect(stopped).toHaveLength(2);
		expect(
			stopped.map((status) =>
				status
					.closest("[data-message-row-id]")
					?.getAttribute("data-message-row-id")
			)
		).toEqual(["sig-stopped-codex", "sig-stopped-claude"]);
		expect(screen.queryByTestId("space-outcome-row")).toBeNull();
	});

	it("aligns a failed message footer with the current user's own message", () => {
		renderSpaceConversationPanel({
			readOnly: false,
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({
					actorProfileId: "human-profile-1",
					id: "sig-wake",
					text: "@Runner(wake) please investigate",
				}),
				createTimelineItem({
					actorProfileId: "system",
					actorProfileKind: "system",
					id: "sig-failure",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					text: "Runner could not reply.",
				}),
			],
		});

		const row = screen
			.getByText("@Runner(wake) please investigate")
			.closest("[data-message-row-id='sig-wake']");
		const footer = row?.querySelector("[data-slot='message-footer']");
		expect(footer?.className).toContain("absolute");
		expect(
			row?.closest('[data-slot="message"]')?.getAttribute("data-align")
		).toBe("end");
		expect(row?.querySelector("[data-testid='space-outcome-row']")).toBeNull();
	});

	it("aligns a failed message footer with another member's message", () => {
		renderSpaceConversationPanel({
			readOnly: false,
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({
					actorName: "Mira",
					actorProfileId: "human-profile-2",
					id: "sig-wake",
					text: "@Runner(wake) please investigate",
				}),
				createTimelineItem({
					actorProfileId: "system",
					actorProfileKind: "system",
					id: "sig-failure",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					text: "Runner could not reply.",
				}),
			],
		});

		const row = screen
			.getByText("@Runner(wake) please investigate")
			.closest("[data-message-row-id='sig-wake']");
		const footer = row?.querySelector("[data-slot='message-footer']");
		expect(footer?.className).toContain("absolute");
		expect(
			row?.closest('[data-slot="message"]')?.getAttribute("data-align")
		).toBe("start");
		expect(row?.querySelector("[data-testid='space-outcome-row']")).toBeNull();
	});

	it("keeps system notice icons aligned with the notice text", () => {
		const noticeText =
			"CLI constraints and the supplemental feedback draft are ready. Reply “Confirm supplemental feedback”; after it is sent, the Amplift organization can see the complete result.";
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorName: "OpenMeld System",
					actorProfileId: "system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld System",
					id: "signal-system-notice",
					signalType: "signal.system_notice",
					systemNoticeType: "policy_blocked",
					text: noticeText,
				}),
			],
		});

		const marker = screen
			.getByText("OpenMeld System")
			.closest("[data-slot='marker']");
		const markerIcon = marker?.querySelector("[data-slot='marker-icon']");
		const markerContent = marker?.querySelector("[data-slot='marker-content']");

		expect(marker?.parentElement?.className).toContain("justify-center");
		expect(marker?.getAttribute("data-variant")).toBe("separator");
		expect(marker?.className).toContain("items-center");
		expect(marker?.className).toContain("gap-2");
		expect(marker?.className).toContain("before:bg-border");
		expect(marker?.className).toContain("after:bg-border");
		expect(marker?.className).toContain("before:min-w-6");
		expect(marker?.className).toContain("after:min-w-6");
		expect(markerIcon?.className).toContain("mt-1");
		expect(markerIcon?.parentElement?.className).toContain("items-start");
		expect(markerContent?.parentElement).toBe(marker);
		expect(markerContent?.className).toContain("max-w-[min(80%,44rem)]");
		expect(markerContent?.className).toContain("text-left");
		expect(markerContent?.className).not.toContain("line-clamp-2");
		expect(markerContent?.textContent).toContain(noticeText);
		const viewport = screen.getByRole("log", {
			name: "Conversation history",
		});
		expect(viewport.className).toContain("outline-none");
		expect(viewport.className).not.toContain("ring-");
	});

	it("renders a durable conversation compaction separator without an active status", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorName: "Center Agent",
					actorProfileId: "agent-profile-center",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					conversationCompaction: {
						completedAtMs: Date.UTC(2026, 4, 27, 10),
						count: 1,
						v: 1,
					},
					id: "signal-compacted-reply",
					text: "I kept the important context.",
				}),
			],
		});

		const markerContent = screen.getByText("Conversation compacted");
		const marker = markerContent.closest("[data-slot='marker']");

		expect(marker?.getAttribute("data-variant")).toBe("separator");
		expect(marker?.getAttribute("data-conversation-compaction-marker")).toBe(
			"true"
		);
		expect(marker?.getAttribute("aria-busy")).toBeNull();
		expect(screen.queryByText("Compacting conversation…")).toBeNull();
	});

	it("opens profile details from the conversation profile header", () => {
		const createdAtMs = Date.UTC(2026, 4, 27, 10, 0, 7);
		const expectedTime = formatTestTime(createdAtMs);
		const profileId = "11111111-1111-4111-8111-111111111111";
		renderSpaceConversationPanel({
			currentOwnerUserId: "user-felix",
			membersSnapshot: createSpaceMembersSnapshot({
				humans: [
					createSpaceMemberHumanSnapshot({
						liveNow: true,
						ownerUserId: "user-felix",
						profileId,
						profileName: "Felix",
					}),
				],
			}),
			timelineItems: [
				createTimelineItem({
					actorProfileId: profileId,
					createdAtMs,
					text: "Message from Felix",
				}),
			],
		});

		const profileHeader = screen.getByRole("button", {
			name: "Check Felix Profile",
		});
		expect(profileHeader.className).toContain("touch-manipulation");
		expect(profileHeader.textContent).toContain("Felix");
		expect(profileHeader.textContent).not.toContain(expectedTime);
		const messageRow = screen
			.getByText("Message from Felix")
			.closest("[data-message-row-id]");
		expect(
			messageRow
				?.closest('[data-slot="message-content"]')
				?.querySelector("time")?.textContent
		).toBe(expectedTime);
		expect(
			profileHeader.contains(
				screen.getByTestId(`space-human-profile-avatar-${profileId}`)
			)
		).toBe(true);

		fireEvent.click(profileHeader);

		const dialog = within(screen.getByRole("dialog"));
		expect(dialog.getByText("Felix")).toBeTruthy();
		expect(dialog.getByText("You")).toBeTruthy();
		expect(dialog.getByText("Now")).toBeTruthy();
		expect(
			dialog
				.getByRole("link", { name: "View Felix profile" })
				.getAttribute("href")
		).toBe(`/o/acme/people/${profileId}`);
		expect(dialog.queryByText("Check this Profile")).toBeNull();
		expect(dialog.queryByText("Person")).toBeNull();
		expect(dialog.queryByText(profileId)).toBeNull();
	});

	it("opens the exact structured Wake target from an inline Agent mention", () => {
		const membersSnapshot = createWakeReceiptMembersSnapshot();
		renderSpaceConversationPanel({
			currentOwnerUserId: "user_felix",
			membersSnapshot,
			timelineItems: [
				createStructuredWakeTimelineItem({
					activationTargets: [TARGET_PROFILE_ID],
					membersSnapshot,
					text: "@Codex 5.6 Sol please review this.",
				}),
			],
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: "Open Codex 5.6 Sol profile (Wake)",
			})
		);

		const dialog = within(screen.getByRole("dialog"));
		expect(dialog.queryByText("How this Agent works")).toBeNull();
		expect(dialog.getAllByText("Codex 5.6 Sol").length).toBeGreaterThan(0);
		expect(dialog.getByText("Available for Wake")).toBeTruthy();
		expect(
			dialog
				.getByRole("link", { name: "Edit Codex 5.6 Sol" })
				.getAttribute("href")
		).toBe(`/o/acme/agents?profileId=${TARGET_PROFILE_ID}`);
		expect(dialog.queryByText("Check more or edit")).toBeNull();
		expect(
			dialog.queryByRole("button", {
				name: "More options for Codex 5.6 Sol",
			})
		).toBeNull();
	});

	it("opens historical profile identity before the member directory is available", () => {
		renderSpaceConversationPanel({
			membersSnapshot: null,
			timelineItems: [createTimelineItem()],
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Check Felix Profile" })
		);

		const dialog = within(screen.getByRole("dialog"));
		expect(dialog.queryByText("Check this Profile")).toBeNull();
		expect(dialog.getAllByText("Felix").length).toBeGreaterThan(0);
		expect(dialog.queryByText("human-profile-1")).toBeNull();
		expect(dialog.queryByText("Profile type")).toBeNull();
		expect(dialog.queryByText("Advanced details")).toBeNull();
		expect(dialog.queryByText("Now")).toBeNull();
	});

	it("attributes Local Agent messages to the owner", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorAgentControllerRef: "builtin:codex",
					actorControllerDisplay: "Codex",
					actorName: "Runner",
					actorOwnerDisplay: "Mira",
					actorOwnerName: "Mira",
					actorOwnerUserId: "user-mira",
					actorProfileId: "agent-profile-1",
					actorProfileKind: "agent",
					actorProfileName: "Runner",
					actorRuntimeDeviceDisplayName: "Felix's MacBook Pro",
					id: "signal-agent",
					text: "Agent reply",
				}),
			],
		});

		expect(
			screen.getByTestId("space-agent-profile-avatar-agent-profile-1")
		).toBeTruthy();
		expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
		expect(screen.getByText("Mira")).toBeTruthy();
		expect(screen.queryByText("Owned by Mira")).toBeNull();
		expect(
			screen.queryByText(
				"Controlled by Felix's MacBook Pro Codex · Owned by Mira"
			)
		).toBeNull();
	});

	it("describes the hosted Center Agent without exposing its runtime", () => {
		renderSpaceConversationPanel({
			timelineItems: [
				createTimelineItem({
					actorAgentControllerRef: "hosted:center-agent",
					actorControllerDisplay: "Remote Agent",
					actorName: "Center Agent",
					actorProfileId: "agent-profile-center",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					actorRuntimeDeviceDisplayName: "hosted:center-agent",
					id: "signal-center-agent",
					text: "Center Agent reply",
				}),
			],
		});

		expect(screen.getByText("Hosted by OpenMeld")).toBeTruthy();
		expect(
			screen.queryByText("Controlled by Remote Agent hosted:center-agent")
		).toBeNull();
	});

	it("requests Stop immediately for the displayed execution and its source", async () => {
		const onWakeStopRequest = vi
			.fn()
			.mockResolvedValue(createWakeStopResponse());
		renderSpaceConversationPanel({
			ephemeralActivityItems: [createWakeProgressItem()],
			onWakeStopRequest,
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "@runner please triage this",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		const stopButton = screen.getByRole("button", {
			name: "Stop @runner",
		});
		const thinkingRow = screen.getByTestId("space-wake-thinking-row");
		expect(thinkingRow.className).toContain("justify-start");
		expect(stopButton.textContent).toBe("Stop");
		expect(stopButton.className).not.toContain("bg-destructive");
		expect(screen.queryByText("Stop Wake")).toBeNull();

		fireEvent.click(stopButton);
		expect(screen.queryByRole("dialog")).toBeNull();

		await waitFor(() => {
			expect(onWakeStopRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					selector: {
						by: "client_message",
						clientMessageId: "client-message-1",
						dispatchId: "dispatch-1",
						targetProfileId: TARGET_PROFILE_ID,
					},
					status: "active",
				})
			);
		});
	});

	it("shows elapsed working time for a single active agent Wake", () => {
		const startedAtMs = Date.UTC(2026, 4, 27, 10, 1);
		vi.useFakeTimers();
		vi.setSystemTime(startedAtMs + 12_000);

		renderSpaceConversationPanel({
			ephemeralActivityItems: [
				createWakeProgressItem({
					updatedAtMs: startedAtMs,
				}),
			],
			onWakeStopRequest: vi.fn(),
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "@runner please triage this",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		const thinkingIndicator = screen.getByTestId(
			"space-wake-thinking-indicator"
		);
		expect(
			thinkingIndicator
				.querySelector("canvas")
				?.getAttribute("data-space-agent-orb-state")
		).toBe("solving");
		expect(thinkingIndicator.textContent).toContain("Working… · 1m 12s");

		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(thinkingIndicator.textContent).toContain("Working… · 1m 13s");
	});

	it("does not offer another viewer Stop without Core eligibility", () => {
		const onWakeStopRequest = vi.fn();
		renderSpaceConversationPanel({
			ephemeralActivityItems: [],
			onWakeStopRequest,
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					createdAtMs: Date.now(),
					id: "sig-source",
					text: "@runner please triage this",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		expect(
			screen.queryByRole("button", { name: "Stop this agent" })
		).toBeNull();
	});

	it("drops the previous account's Stop control when the acting profile changes", () => {
		const props = createSpaceConversationPanelProps({
			ephemeralActivityItems: [createWakeProgressItem()],
			onWakeStopRequest: vi.fn(),
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});
		const view = render(<SpaceConversationPanel {...props} />);
		expect(screen.getByRole("button", { name: "Stop @runner" })).toBeTruthy();
		view.rerender(
			<SpaceConversationPanel
				{...props}
				ephemeralActivityItems={[]}
				selfProfileId="another-human-profile"
			/>
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByRole("button", { name: "Stop @runner" })).toBeNull();
	});

	it("labels an acknowledged Stop request as stopping", () => {
		const selector = {
			by: "client_message" as const,
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			targetProfileId: TARGET_PROFILE_ID,
		};
		renderSpaceConversationPanel({
			ephemeralActivityItems: [createWakeProgressItem()],
			onWakeStopRequest: vi.fn(),
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "@runner please triage this",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
			wakeStopRequestStatusBySelectorKey: new Map([
				[
					`dispatch:${selector.dispatchId}:${selector.targetProfileId}`,
					"cancellation_requested",
				],
			]),
		});

		const stopButton = screen.getByRole("button", {
			name: "Stop request pending for @runner",
		});
		expect(stopButton.textContent).toBe("Stopping…");
		expect((stopButton as HTMLButtonElement).disabled).toBe(true);
	});

	it("does not request Stop for an unsupported active Wake in the main timeline", () => {
		const onWakeStopRequest = vi.fn();
		renderSpaceConversationPanel({
			ephemeralActivityItems: [
				createWakeProgressItem({
					wakeStopEligibility: UNSUPPORTED_WAKE_STOP_ELIGIBILITY,
				}),
			],
			onWakeStopRequest,
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "@runner please triage this",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		expect(screen.queryByText("Stop")).toBeNull();
		expect(
			screen.queryByRole("dialog", { name: "Stop this Wake?" })
		).toBeNull();
		expect(onWakeStopRequest).not.toHaveBeenCalled();
	});

	it("shows the structured Wake Stop request failure from the API client", async () => {
		const onWakeStopRequest = vi.fn().mockRejectedValue({
			code: "http_404",
			message: "Not Found.",
			requestId: "req-404",
			status: 404,
			upstreamCode: null,
		});
		renderSpaceConversationPanel({
			ephemeralActivityItems: [createWakeProgressItem()],
			onWakeStopRequest,
			readOnly: false,
			timelineItems: [
				createTimelineItem({
					id: "sig-source",
					text: "@runner please triage this",
					wakeClientMessageId: "client-message-1",
					wakeSourceSignalId: "sig-source",
					wakeTargetProfileIds: [TARGET_PROFILE_ID],
				}),
			],
		});

		fireEvent.click(screen.getByRole("button", { name: "Stop @runner" }));

		await waitFor(() => {
			expect(
				screen.getByText("OpenMeld couldn't request Stop. Not Found.")
			).toBeTruthy();
		});
	});

	describe("render window", () => {
		it("mounts only the newest loaded messages when a long conversation opens", () => {
			renderSpaceConversationPanel({
				hasEarlierHistory: false,
				timelineItems: createLongConversation(120),
			});
			const log = screen.getByRole("log", { name: "Conversation history" });

			expect(readMountedMessageIds(log)).toEqual(
				Array.from({ length: 40 }, (_, index) => `message-${index + 81}`)
			);
		});

		it("mounts loaded history near the top before fetching more, keeping the visible message in place", async () => {
			const onLoadEarlierHistory = vi.fn(async () => undefined);
			renderSpaceConversationPanel({
				hasEarlierHistory: true,
				onLoadEarlierHistory,
				timelineItems: createLongConversation(120),
			});
			const log = screen.getByRole("log", { name: "Conversation history" });
			const content = log.querySelector<HTMLElement>(
				"[data-slot='message-scroller-content']"
			);
			if (!content) {
				throw new Error("Expected conversation content");
			}
			setElementScrollMetrics(log, {
				clientHeight: 300,
				scrollHeight: 4000,
				scrollTop: 200,
			});
			// Each scroller item is 100px tall, in DOM order.
			const geometry = vi
				.spyOn(HTMLElement.prototype, "getBoundingClientRect")
				.mockImplementation(function (this: HTMLElement) {
					if (this === log) {
						return domRect({ top: 0, bottom: 300 });
					}
					const index = [...content.children].indexOf(this);
					if (index < 0) {
						return domRect({ top: 0, bottom: 0 });
					}
					const top = index * 100 - log.scrollTop;
					return domRect({ top, bottom: top + 100 });
				});
			const visibleItem = content.children.item(2) as HTMLElement;
			const visibleTop = visibleItem.getBoundingClientRect().top;

			fireEvent.scroll(log);

			await waitFor(() =>
				expect(readMountedMessageIds(log)[0]).toBe("message-51")
			);
			expect(visibleItem.isConnected).toBe(true);
			expect(visibleItem.getBoundingClientRect().top).toBe(visibleTop);
			expect(log.scrollTop).toBeGreaterThan(200);
			expect(onLoadEarlierHistory).not.toHaveBeenCalled();
			geometry.mockRestore();
		});

		it("mounts and focuses a linked message above the newest window", async () => {
			Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
				configurable: true,
				value: vi.fn(),
			});
			const onLoadEarlierHistory = vi.fn(async () => undefined);
			renderSpaceConversationPanel({
				hasEarlierHistory: true,
				initialFocusSignalId: "message-3",
				onLoadEarlierHistory,
				timelineItems: createLongConversation(120),
			});

			await waitFor(() =>
				expect(document.activeElement?.getAttribute("data-signal-id")).toBe(
					"message-3"
				)
			);
			expect(onLoadEarlierHistory).not.toHaveBeenCalled();
		});

		it("mounts a loaded unread target above the window before jumping to it", async () => {
			Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
				configurable: true,
				value: vi.fn(),
			});
			const open = vi.fn(async () => true);
			renderSpaceConversationPanel({
				historyNavigation: createTestHistoryNavigation({ open }),
				timelineItems: createLongConversation(120),
				unreadTargets: [
					{
						occurredAtMs: 1,
						signalId: "message-5",
						threadRootSignalId: null,
					},
				],
				unreadCount: 1,
				unreadStateReady: true,
			});
			const log = screen.getByRole("log", { name: "Conversation history" });
			expect(readMountedMessageIds(log)).not.toContain("message-5");

			fireEvent.click(
				await screen.findByRole("button", {
					name: "1 unread update. Jump to first unread",
				})
			);

			await waitFor(() =>
				expect(document.activeElement?.getAttribute("data-signal-id")).toBe(
					"message-5"
				)
			);
			expect(open).not.toHaveBeenCalled();
		});

		it("mounts a history-loaded unread target that lands above the window", async () => {
			Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
				configurable: true,
				value: vi.fn(),
			});
			let finishLoad: ((result: true) => void) | undefined;
			const open = vi.fn(
				(
					_signalId: string,
					_signal?: AbortSignal,
					onLoaded?: (result: true | "latest") => void
				) => {
					finishLoad = (result) => onLoaded?.(result);
					return Promise.resolve(true);
				}
			);
			const overrides: SpaceConversationPanelOverrides = {
				historyNavigation: createTestHistoryNavigation({ open }),
				timelineItems: createLongConversation(120).slice(10),
				unreadTargets: [
					{
						occurredAtMs: 1,
						signalId: "message-5",
						threadRootSignalId: null,
					},
				],
				unreadCount: 1,
				unreadStateReady: true,
			};
			const view = renderSpaceConversationPanel(overrides);
			fireEvent.click(
				await screen.findByRole("button", {
					name: "1 unread update. Jump to first unread",
				})
			);
			await waitFor(() => expect(finishLoad).toBeTypeOf("function"));

			await act(() => {
				finishLoad?.(true);
				view.rerender(
					<SpaceConversationPanel
						{...createSpaceConversationPanelProps({
							...overrides,
							timelineItems: createLongConversation(120),
						})}
					/>
				);
			});

			await waitFor(() =>
				expect(document.activeElement?.getAttribute("data-signal-id")).toBe(
					"message-5"
				)
			);
		});

		it("keeps the history rail's placement for a target it has to mount first", async () => {
			const matchMedia = createMatchMediaMock();
			vi.stubGlobal("matchMedia", (query: string) => ({
				...matchMedia(query),
				matches:
					query === "(min-width: 640px) and (hover: hover) and (pointer: fine)",
			}));
			localStorage.setItem("openmeld.space.history-slider", "on");
			const open = vi.fn(async () => true);
			renderSpaceConversationPanel({
				historyNavigation: createTestHistoryNavigation({
					directory: {
						total: 120,
						entries: [
							{
								signalId: "message-5",
								endSignalId: "message-5",
								startAt: 0,
								endAt: 1,
								count: 1,
								author: "Felix",
								preview: "Message 5",
							},
						],
					},
					open,
				}),
				timelineItems: createLongConversation(120),
			});
			const log = screen.getByRole("log", { name: "Conversation history" });
			setElementScrollMetrics(log, {
				clientHeight: 300,
				scrollHeight: 12_000,
				scrollTop: 11_700,
			});
			const geometry = vi
				.spyOn(HTMLElement.prototype, "getBoundingClientRect")
				.mockImplementation(function (this: HTMLElement) {
					if (this === log) {
						return domRect({ top: 0, bottom: 300 });
					}
					if (this.dataset.signalId === "message-5") {
						const top = 1000 - log.scrollTop;
						return domRect({ top, bottom: top + 60 });
					}
					return domRect({ top: 0, bottom: 0 });
				});
			expect(readMountedMessageIds(log)).not.toContain("message-5");
			const tick = document.querySelector(".space-history-tick");
			if (!tick) {
				throw new Error("Expected a history rail target");
			}

			fireEvent.click(tick);

			await waitFor(() =>
				expect(document.activeElement?.getAttribute("data-signal-id")).toBe(
					"message-5"
				)
			);
			// The rail asks for its target 24px below the visible top, and the
			// delayed realignment must keep that placement instead of centering.
			expect(log.scrollTop).toBe(976);
			for (let frame = 0; frame < 3; frame++) {
				await act(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() => resolve())
						)
				);
			}
			expect(log.scrollTop).toBe(976);
			geometry.mockRestore();
		});

		it("names the first mounted day while its date marker is not mounted", () => {
			const firstDayMs = new Date(2026, 4, 27, 6, 0).getTime();
			renderSpaceConversationPanel({
				hasEarlierHistory: false,
				timelineItems: Array.from({ length: 120 }, (_, index) =>
					createTimelineItem({
						createdAtMs: firstDayMs + index * 6 * 60 * 1000,
						id: `message-${index + 1}`,
						text: `Message ${index + 1}`,
					})
				),
			});
			const log = screen.getByRole("log", { name: "Conversation history" });

			expect(log.querySelector("[data-conversation-date-marker]")).toBeNull();
			expect(
				document.querySelector("[data-slot='conversation-date-pill-surface']")
			).toBeTruthy();
		});

		it("mounts a saved reading anchor above the newest window", () => {
			writeSpaceConversationPosition(
				"human-profile-1:space-conversation:space-view-test",
				{ anchorSignalId: "message-12", offsetFromVisibleTop: 0 }
			);
			renderSpaceConversationPanel({
				hasEarlierHistory: false,
				timelineItems: createLongConversation(120),
			});
			const log = screen.getByRole("log", { name: "Conversation history" });

			expect(readMountedMessageIds(log)).toContain("message-12");
			expect(screen.queryByText("Restoring your reading position…")).toBeNull();
		});

		it("keeps mounted rows and follows the bottom when a new message arrives", async () => {
			const messages = createLongConversation(120);
			const view = renderSpaceConversationPanel({
				hasEarlierHistory: false,
				timelineItems: messages,
			});
			const log = screen.getByRole("log", { name: "Conversation history" });
			setElementScrollMetrics(log, {
				clientHeight: 300,
				scrollHeight: 4000,
				scrollTop: 3700,
			});
			Object.defineProperty(log, "scrollTo", {
				configurable: true,
				value: (options: ScrollToOptions) => {
					log.scrollTop = Number(options.top);
				},
			});

			setElementScrollMetrics(log, {
				clientHeight: 300,
				scrollHeight: 4100,
				scrollTop: 3700,
			});
			act(() => {
				view.rerender(
					<SpaceConversationPanel
						{...createSpaceConversationPanelProps({
							hasEarlierHistory: false,
							timelineItems: createLongConversation(121),
						})}
					/>
				);
			});

			await waitFor(() => expect(log.scrollTop).toBe(3800));
			const mounted = readMountedMessageIds(log);
			expect(mounted[0]).toBe("message-81");
			expect(mounted.at(-1)).toBe("message-121");
		});
	});
});

function createLongConversation(count: number): SpaceTimelineItem[] {
	// Ten minutes apart, so every message is its own conversation entry.
	return Array.from({ length: count }, (_, index) =>
		createTimelineItem({
			createdAtMs: Date.UTC(2026, 4, 27, 0, 0) + index * 10 * 60 * 1000,
			id: `message-${index + 1}`,
			text: `Message ${index + 1}`,
		})
	);
}

function readMountedMessageIds(log: HTMLElement): string[] {
	return [
		...log.querySelectorAll<HTMLElement>("[data-message-id^='message-']"),
	].map((element) => element.dataset.messageId ?? "");
}

const TARGET_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const SECOND_TARGET_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const CANCEL_BACKED_WAKE_STOP_ELIGIBILITY = {
	controlMode: "cancel",
	reasonCode: null,
	reliability: "native_cancel",
	status: "eligible",
} satisfies NonNullable<WakeProgressItem["wakeStopEligibility"]>;
const UNSUPPORTED_WAKE_STOP_ELIGIBILITY = {
	controlMode: null,
	reasonCode: "agent_controller_interface.stop_unsupported",
	reliability: "unsupported",
	status: "not_eligible",
} satisfies NonNullable<WakeProgressItem["wakeStopEligibility"]>;

function renderSpaceConversationPanel(
	overrides: SpaceConversationPanelOverrides = {}
) {
	return render(
		<SpaceConversationPanel {...createSpaceConversationPanelProps(overrides)} />
	);
}

function renderSpaceConversationPanelWithViewTabs(
	overrides: SpaceConversationPanelOverrides = {}
) {
	return render(<SpaceConversationPanelHarness overrides={overrides} />);
}

function SpaceConversationPanelHarness(input: {
	overrides: SpaceConversationPanelOverrides;
}) {
	const [activeSpaceView, setActiveSpaceView] = useState<SpaceView>(
		input.overrides.activeSpaceView ?? "messages"
	);
	const onSpaceViewChange = (view: SpaceView) => {
		setActiveSpaceView(view);
		input.overrides.onSpaceViewChange?.(view);
	};
	const props = createSpaceConversationPanelProps({
		...input.overrides,
		activeSpaceView,
		onSpaceViewChange,
	});

	return (
		<>
			<SpaceViewTabs
				activeView={activeSpaceView}
				idPrefix={props.spaceViewIdPrefix}
				onViewChange={onSpaceViewChange}
			/>
			<SpaceConversationPanel {...props} />
		</>
	);
}

function createWakeReceiptMembersSnapshot() {
	return createSpaceMembersSnapshot({
		agents: [
			createSpaceMemberAgentSnapshot({
				profileId: TARGET_PROFILE_ID,
				profileName: "Codex 5.6 Sol",
			}),
			createSpaceMemberAgentSnapshot({
				profileId: SECOND_TARGET_PROFILE_ID,
				profileName: "Claude Opus 4.8",
			}),
		],
	});
}

function createStructuredWakeTimelineItem(input: {
	activationTargets: readonly string[];
	membersSnapshot: SpaceConversationPanelInput["membersSnapshot"];
	text: string;
}): SpaceTimelineItem {
	const [item] = buildSpaceTimelineItems({
		envelopes: [
			{
				data: {
					messageEnvelope: {
						activationTargets: [...input.activationTargets],
						referenceTargets: [],
						text: input.text,
					},
					text: input.text,
				},
				id: `sig-wake-${input.activationTargets.join("-")}`,
				profile: {
					kind: "human",
					profileId: "human-profile-1",
					profileName: "Felix",
				},
				spaceId: "space-1",
				ts: Date.UTC(2026, 6, 11, 10),
				type: "signal.text",
				v: 1,
			},
		],
		membersSnapshot: input.membersSnapshot,
	});
	if (!item) {
		throw new Error(
			"Expected the structured Wake signal to reach the timeline."
		);
	}
	return item;
}

function createSpaceConversationPanelProps(
	overrides: SpaceConversationPanelOverrides = {}
): SpaceConversationPanelInput {
	const {
		composerFileLimitReached = false,
		composerHasAuthoredMentions,
		hasEarlierHistory = true,
		historyIsPending = false,
		isCenterAgentDirectMessage = false,
		isCreatingThread = false,
		isDirectMessage = false,
		isLoadingEarlierHistory = false,
		isPersonalContext,
		isSendingMessage = false,
		readOnly = true,
		threadsIsLoading,
		unreadStateReady = false,
		viewState,
		...propOverrides
	} = overrides;
	return {
		activeSpaceView: "messages",
		agentRecoveryPlansByProfileId: new Map(),
		allowedActions: [],
		centerAgentProfileId: "agent-profile-center",
		composerFiles: [],
		composerBlockedWakeProfileId: null,
		composerErrorMessage: null,
		composerReplyToSignalId: null,
		composerText: "",
		currentOwnerUserId: null,
		emptyStateDescription: null,
		ephemeralActivityItems: [],
		historyActionErrorMessage: null,
		historyErrorMessage: null,
		firstUnreadSignalId: null,
		isAgentRecoveryPending: () => false,
		isDiagnosticReportPending: () => false,
		isDiagnosticReportSent: () => false,
		membersSnapshot: null,
		modelCatalog: null,
		onAgentRecoveryAction: async () => undefined,
		onAddComposerFiles: async () => undefined,
		onClearComposerReplyTo: () => undefined,
		onComposerEditorChange: () => undefined,
		onCreateThread: async () => undefined,
		onLoadEarlierHistory: async () => undefined,
		onMentionButtonClick: () => undefined,
		onOpenThread: () => undefined,
		onOpenSpaceFile: () => undefined,
		onReplyToMessage: () => undefined,
		onRemoveComposerFile: () => undefined,
		onReportMessage: async () => undefined,
		onSend: async () => undefined,
		onSendStarterPrompt: async () => undefined,
		onSpaceViewChange: () => undefined,
		orgSlug: "acme",
		selfProfileId: "human-profile-1",
		spaceViewIdPrefix: "space-view-test",
		textareaRef: { current: null },
		threadPreviews: [],
		threads: [],
		timelineItems: [],
		unreadTargets: [],
		unreadCount: 0,
		wakeFailureTargetContextsByProfileId: new Map(),
		...propOverrides,
		viewState: {
			composerFileLimitReached,
			composerHasAuthoredMentions,
			hasEarlierHistory,
			historyIsPending,
			isCenterAgentDirectMessage,
			isCreatingThread,
			isDirectMessage,
			isLoadingEarlierHistory,
			isPersonalContext,
			isSendingMessage,
			readOnly,
			threadsIsLoading,
			unreadStateReady,
			...viewState,
		},
	};
}

function createTestHistoryNavigation(
	overrides: Partial<
		NonNullable<SpaceConversationPanelInput["historyNavigation"]>
	> = {}
): NonNullable<SpaceConversationPanelInput["historyNavigation"]> {
	return {
		activeWindow: null,
		directory: undefined,
		directoryError: false,
		directoryPending: false,
		error: null,
		notice: null,
		errorDirection: undefined,
		hasHiddenLiveHistory: false,
		latest: vi.fn(),
		loadAfter: vi.fn(async () => false),
		loadBefore: vi.fn(async () => false),
		open: vi.fn(async () => false),
		hrefForSignalId: undefined,
		earlierHref: undefined,
		latestHref: undefined,
		newerHref: undefined,
		pending: false,
		pendingDirection: undefined,
		retry: vi.fn(),
		retryDirectory: vi.fn(),
		revealCachedBefore: vi.fn(),
		visibleLiveEnvelopes: [],
		...overrides,
	};
}

function createReadyComposerFile() {
	return {
		upload: {
			id: "11111111-1111-4111-8111-111111111111",
			expiresAt: "2026-08-30T00:00:00.000Z",
			mimeType: "application/pdf",
			name: "launch-brief.pdf",
			sizeBytes: 4096,
		},
		errorMessage: null,
		errorRequestId: null,
		failurePhase: null,
		fileName: "launch-brief.pdf",
		localId: "local-file-1",
		mimeType: "application/pdf",
		previewUrl: null,
		progress: 1,
		publishMutationId: "publish-file-1",
		status: "ready" as const,
	};
}

function domRect(input: { bottom: number; top: number }): DOMRect {
	return {
		bottom: input.bottom,
		height: input.bottom - input.top,
		left: 0,
		right: 0,
		toJSON: () => ({}),
		top: input.top,
		width: 0,
		x: 0,
		y: input.top,
	};
}

function createFailedComposerFile() {
	return {
		upload: null,
		errorMessage: "OpenMeld couldn't add this file. Try again.",
		errorRequestId: "request-file-failed",
		failurePhase: "stage" as const,
		fileName: "broken.pdf",
		localId: "local-file-failed",
		mimeType: "application/pdf",
		previewUrl: null,
		progress: 100,
		publishMutationId: "publish-file-failed",
		status: "failed" as const,
	};
}

function setElementScrollMetrics(
	element: HTMLElement,
	input: {
		clientHeight: number;
		scrollHeight: number;
		scrollTop: number;
	}
) {
	Object.defineProperties(element, {
		clientHeight: {
			configurable: true,
			value: input.clientHeight,
		},
		scrollHeight: {
			configurable: true,
			value: input.scrollHeight,
		},
		scrollTop: {
			configurable: true,
			value: input.scrollTop,
			writable: true,
		},
	});
}

function createTestDomRect(input: {
	bottom: number;
	height: number;
	top: number;
}): DOMRect {
	return {
		bottom: input.bottom,
		height: input.height,
		left: 0,
		right: 0,
		top: input.top,
		width: 0,
		x: 0,
		y: input.top,
		toJSON: () => ({}),
	};
}

function createTimelineItem(
	overrides: Partial<SpaceTimelineItem> = {}
): SpaceTimelineItem {
	return {
		attachments: [],
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorAgentControllerRef: null,
		actorName: "Felix",
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: "human-profile-1",
		actorProfileKind: "human",
		actorProfileName: "Felix",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		clientMessageId: null,
		createdAtMs: Date.UTC(2026, 4, 27, 10),
		deliveryState: "sent",
		id: "signal-1",
		newMessagesDuringComposition: null,
		spaceId: "space-1",
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		systemNoticeType: null,
		text: "Existing message",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
		...overrides,
	};
}

function createSpaceReferences() {
	return new Map([
		[
			REFERENCED_SPACE_ID,
			{ name: "Launch Planning", spaceId: REFERENCED_SPACE_ID },
		],
	]);
}

function createThread(): SpaceThread {
	return {
		createdAt: "2026-07-10T00:00:00.000Z",
		createdByProfileId: "11111111-1111-4111-8111-111111111111",
		rootSignalId: "sig-root",
		spaceId: "space-123",
		threadId: "thr_11111111-1111-4111-8111-111111111111",
		updatedAt: "2026-07-10T00:00:00.000Z",
	};
}

function createThreadPreview(threadId: string): SpaceThreadPreview {
	const signal = createThreadPreviewSignal();
	return {
		placements: [
			{
				createdAt: "2026-07-10T00:00:01.000Z",
				placement: "thread",
				signalId: signal.id,
				threadId,
			},
		],
		replyCount: 1,
		signals: [signal],
		threadId,
	};
}

function createThreadPreviewSignal(): Extract<
	SignalEnvelope,
	{ type: "signal.text" }
> {
	return {
		data: {
			text: `https://example.com /spaces/${REFERENCED_SPACE_ID}`,
		},
		id: "sig-thread-preview",
		profile: {
			kind: "human",
			profileId: "11111111-1111-4111-8111-111111111111",
			profileName: "Felix",
		},
		spaceId: "space-123",
		ts: Date.UTC(2026, 6, 10),
		type: "signal.text",
		v: 1,
	};
}

function createWakeProgressItem(input?: {
	omitWakeStopEligibility?: boolean;
	phase?: WakeProgressItem["phase"];
	sourceSignalId?: string;
	updatedAtMs?: number;
	wakeStopEligibility?: WakeProgressItem["wakeStopEligibility"];
}): WakeProgressItem {
	const item: WakeProgressItem = {
		clientMessageId: "client-message-1",
		dispatchId: "dispatch-1",
		failureReasonCode: null,
		message: "@runner · Working… on this computer...",
		phase: input?.phase ?? "running",
		sourceSignalId: input?.sourceSignalId ?? "sig-source",
		startedAtMs: input?.updatedAtMs ?? Date.UTC(2026, 4, 27, 10, 1),
		targetLabel: "@runner",
		targetProfileId: TARGET_PROFILE_ID,
		terminal: false,
		updatedAtMs: input?.updatedAtMs ?? Date.UTC(2026, 4, 27, 10, 1),
	};
	if (!input?.omitWakeStopEligibility) {
		item.wakeStopEligibility =
			input?.wakeStopEligibility ?? CANCEL_BACKED_WAKE_STOP_ELIGIBILITY;
	}
	return item;
}

function createInlinePermissionProgressItem(input: {
	runtimeCoordinatorExecutionId: string;
	title: string;
}): WakeProgressItem {
	const interactionId = "provider-interaction-reused";
	return {
		...createWakeProgressItem({ sourceSignalId: "sig-wake" }),
		pendingInteraction: {
			canRespond: true,
			expiresAtMs: Date.UTC(2026, 6, 29),
			interactionId,
			kind: "permission",
			request: {
				expiresAtMs: Date.UTC(2026, 6, 29),
				interactionId,
				kind: "permission",
				options: [
					{
						intent: "allow_once",
						label: "Allow once",
						optionId: "allow-once",
					},
				],
				requestedAtMs: Date.UTC(2026, 6, 28),
				subject: { type: "tool" },
				title: input.title,
				v: 1,
			},
			requestedAtMs: Date.UTC(2026, 6, 28),
		},
		runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
	};
}

function createWakeStopResponse(): PostSpaceWakeStopResponse {
	return {
		cancellationState: {
			observedAtMs: Date.UTC(2026, 4, 27, 10, 2),
			reasonCode: null,
			status: "requested",
		},
		ok: true,
		runtimeCoordinatorExecutionId: "rce_123",
		status: "cancellation_requested",
		targetProfileId: TARGET_PROFILE_ID,
	};
}

function createMinimalMessageDetailsResponse(): GetSpaceMessageDetailsResponse {
	return {
		agentContext: notApplicableAgentContext(),
		diagnostics: {
			signalId: "sig-unused",
			traceSelectors: [],
		},
		message: {
			actor: {
				displayName: "Felix",
				profileHandle: null,
				profileId: "human-1",
				profileKind: "human",
				profileName: "Felix",
			},
			sentAtMs: Date.UTC(2026, 4, 27, 10, 0),
			signalId: "sig-unused",
			signalType: "signal.text",
		},
		query: { signalId: "sig-unused", spaceId: "space-123" },
		replyContext: {
			previewText: notApplicableFact(),
			replyingToAuthor: notApplicableFact(),
			replyingToSignalId: notApplicableFact(),
			resolved: false,
			state: "not_applicable",
		},
		wakeContext: {
			clientMessageId: notApplicableFact(),
			sourceSignalId: notApplicableFact(),
			state: "not_applicable",
			targets: [],
		},
	};
}

function notApplicableAgentContext(): GetSpaceMessageDetailsResponse["agentContext"] {
	return {
		agentControllerConversationId: notApplicableFact(),
		agentControllerRef: notApplicableFact(),
		bindingId: notApplicableFact(),
		profileId: notApplicableFact(),
		profileName: notApplicableFact(),
		state: "not_applicable",
		workspaceFingerprint: notApplicableFact(),
		workspacePath: notApplicableFact(),
		openMeldServiceRuntimeId: notApplicableFact(),
	};
}

function notApplicableFact(): GetSpaceMessageDetailsResponse["agentContext"]["profileId"] {
	return {
		source: "none",
		state: "not_applicable",
		value: null,
	};
}

function createMatchMediaMock(matches = false): typeof window.matchMedia {
	return vi.fn().mockImplementation((query: string) => ({
		addEventListener: vi.fn(),
		addListener: vi.fn(),
		dispatchEvent: vi.fn(),
		matches,
		media: query,
		onchange: null,
		removeEventListener: vi.fn(),
		removeListener: vi.fn(),
	}));
}

function formatTestTime(createdAtMs: number): string {
	return new Intl.DateTimeFormat("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(createdAtMs);
}

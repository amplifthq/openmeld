import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { createRef, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { projectQueryKeys } from "#/query/organizations/projects";
import { SpaceComposer } from "./space-composer";
import type { SpaceComposerSendOptions } from "./space-composer-device-wait";
import type { SpaceComposerEditorHandle } from "./space-composer-editor";
import {
	SpaceComposerAgentOptions,
	type SpaceComposerTaskChoice,
} from "./space-composer-task-menu";
import {
	SpaceWakeRecommendationScope,
	useSpaceWakeRecommendation,
} from "./space-wake-recommendation";
import type { SpaceComposerAddressingTarget } from "./use-space-mention-authoring";

afterEach(cleanup);
// The interaction harness supplies a known project; directory reads have their own owner.
vi.mock("./space-composer-agent-options", () => ({
	SpaceComposerAgentOptionsWithProject: (
		props: Parameters<typeof SpaceComposerAgentOptions>[0]
	) => (
		<SpaceComposerAgentOptions
			{...props}
			folders={COMPOSER_FOLDERS}
			projectName="OpenMeld"
		/>
	),
}));
const TASK_ACCESS_MENU = /^Access/;
const FOLDER_MENU = /^Folder/;
// The owner's folders as the folder read returns them (smoke R2B-08).
const COMPOSER_FOLDERS = vi.hoisted(() => [
	{
		displayName: "folder-two",
		folderId: "3c2e8f8a-6b55-4b8e-9a43-0f3f2c9d7e21",
		isDefault: true,
	},
	{
		displayName: "folder-one",
		folderId: "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11",
		isDefault: false,
	},
]);

it.each([
	false,
	true,
])("forks source history without carrying another Project (%s)", async (hasProject) => {
	const onChange = vi.fn();
	render(
		<DropdownMenu>
			<DropdownMenuTrigger>Options</DropdownMenuTrigger>
			<FluidDropdownMenuContent>
				<SpaceComposerAgentOptions
					choice={
						hasProject
							? {
									targetProfileId: "agent",
									label: "Project A",
									selection: {
										mode: "new",
										access: "workspace",
										workspace: "isolated",
										projectWork: {
											projectId: "project-a",
											repositoryFingerprint: `sha256:${"a".repeat(64)}`,
										},
									},
								}
							: undefined
					}
					onChange={onChange}
					sources={[
						{
							targetProfileId: "agent",
							sourceWakeId: "wake-previous",
							label: "Review upload",
						},
					]}
					supportsCurrentFolder
					targetProfileId="agent"
				/>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
	fireEvent.click(screen.getByRole("button", { name: "Options" }));
	fireEvent.click(await screen.findByText("Session"));
	const choices = await screen.findAllByRole("menuitemradio", {
		name: "Review upload",
	});
	const forkChoice = choices[1];
	if (!forkChoice) {
		throw new Error("Fork choice missing");
	}
	fireEvent.click(forkChoice);
	expect(onChange).toHaveBeenCalledWith({
		targetProfileId: "agent",
		label: "Fork: Review upload",
		selection: { mode: "fork", sourceWakeId: "wake-previous" },
	});
});

it.each([
	"resume",
	"fork",
] as const)("inherits files and Project when using %s", async (mode) => {
	render(
		<DropdownMenu>
			<DropdownMenuTrigger>Options</DropdownMenuTrigger>
			<FluidDropdownMenuContent>
				<SpaceComposerAgentOptions
					choice={{
						targetProfileId: "agent",
						label: "Source B",
						selection: { mode, sourceWakeId: "wake-b" },
					}}
					onChange={vi.fn()}
					projectName="Project B"
					sources={[]}
					supportsCurrentFolder
					targetProfileId="agent"
				/>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
	fireEvent.click(screen.getByRole("button", { name: "Options" }));
	for (const label of ["Working copy", "Access"]) {
		const option = (await screen.findByText(label)).closest("[role=menuitem]");
		expect(option?.getAttribute("aria-disabled")).toBe("true");
	}
});

it.each([
	{
		projectName: "OpenMeld",
		supportsCurrentFolder: true,
		supportsAccessRestrictions: false,
		labels: ["Use agent settings"],
	},
	{
		projectName: undefined,
		supportsCurrentFolder: true,
		labels: ["Use agent settings", "No project files"],
	},
	{
		projectName: "OpenMeld",
		supportsCurrentFolder: false,
		labels: ["Use agent settings", "No project files", "Project files only"],
	},
])("only offers file modes supported by the project and agent: $projectName / $supportsCurrentFolder", async ({
	labels,
	...capabilities
}) => {
	render(
		<DropdownMenu>
			<DropdownMenuTrigger>Options</DropdownMenuTrigger>
			<FluidDropdownMenuContent>
				<SpaceComposerAgentOptions
					{...capabilities}
					onChange={vi.fn()}
					sources={[]}
					targetProfileId="agent"
				/>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
	fireEvent.click(screen.getByRole("button", { name: "Options" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: TASK_ACCESS_MENU })
	);
	expect(
		(await screen.findAllByRole("menuitemradio")).map(
			(item) => item.textContent
		)
	).toEqual(labels);
});

it("keeps two agents' session choices independent and sends without a task by default", async () => {
	const onSubmit = vi.fn<(options?: SpaceComposerSendOptions) => void>();
	render(<MultiAgentHarness onSubmit={onSubmit} />);
	expect(screen.queryByRole("menu")).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Change relation for Engineer" })
	);
	fireEvent.click(await screen.findByText("Session"));
	fireEvent.click(await screen.findByText("Start new"));
	fireEvent.click(
		screen.getByRole("button", { name: "Change relation for QA" })
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: TASK_ACCESS_MENU })
	);
	fireEvent.click(await screen.findByText("Read files only"));
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
		contextSelections: {
			[agentTargets[0].profileId]: { mode: "new" },
			[agentTargets[1].profileId]: {
				mode: "new",
				access: "read_only",
				workspace: "current",
			},
		},
	});
	expect(onSubmit.mock.calls[0]?.[0]?.taskDraft).toBeUndefined();
});

it("sends the chosen folder with the message for that agent", async () => {
	const onSubmit = vi.fn<(options?: SpaceComposerSendOptions) => void>();
	render(<MultiAgentHarness onSubmit={onSubmit} />);
	fireEvent.click(
		screen.getByRole("button", { name: "Change relation for Engineer" })
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: FOLDER_MENU }));
	const folderOne = (await screen.findAllByRole("menuitemradio")).find(
		(item) => item.textContent === "folder-one"
	);
	if (!folderOne) {
		throw new Error("Folder choice missing");
	}
	fireEvent.click(folderOne);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	expect(onSubmit.mock.calls[0]?.[0]?.contextSelections).toEqual({
		[agentTargets[0].profileId]: {
			folderId: "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11",
			mode: "new",
		},
	});
});

it.each([
	{
		setting: "access",
		choices: [
			["Access", "No project files"],
			["Access", "Use agent settings"],
		],
	},
	{
		setting: "working copy",
		choices: [
			["Working copy", "Separate copy"],
			["Working copy", "Current folder"],
		],
	},
] as const)("returns to Automatic after changing $setting", async ({
	choices,
}) => {
	const onSubmit = vi.fn<(options?: SpaceComposerSendOptions) => void>();
	render(<MultiAgentHarness onSubmit={onSubmit} />);
	for (const [menu, choice] of choices) {
		fireEvent.click(
			screen.getByRole("button", { name: "Change relation for Engineer" })
		);
		fireEvent.click(await screen.findByText(menu));
		fireEvent.click(await screen.findByText(choice));
	}
	fireEvent.click(
		screen.getByRole("button", { name: "Change relation for Engineer" })
	);
	fireEvent.click(await screen.findByText("Session"));
	const automatic = await screen.findByRole("menuitemradio", {
		name: "Automatic",
	});
	expect(automatic.getAttribute("aria-disabled")).not.toBe("true");
	fireEvent.click(automatic);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	expect(onSubmit.mock.calls[0]?.[0]?.contextSelections).toEqual({
		[agentTargets[0].profileId]: { mode: "auto" },
	});
});

it.each([
	true,
	false,
])("selects a copy independently from access restrictions (%s)", async (supportsCurrentFolder) => {
	const onChange = vi.fn();
	const projectWork = {
		projectId: "project-a",
		repositoryFingerprint: `sha256:${"a".repeat(64)}`,
	};
	function OptionsHarness() {
		const [choice, setChoice] = useState<SpaceComposerTaskChoice>({
			targetProfileId: "agent",
			label: "Start new",
			selection: { mode: "new", workspace: "current", projectWork },
		});
		return (
			<DropdownMenu>
				<DropdownMenuTrigger>Options</DropdownMenuTrigger>
				<FluidDropdownMenuContent>
					<SpaceComposerAgentOptions
						choice={choice}
						onChange={(next) => {
							if (next) {
								setChoice(next);
							}
							onChange(next);
						}}
						projectName="Project A"
						sources={[]}
						supportsCurrentFolder={supportsCurrentFolder}
						targetProfileId="agent"
					/>
				</FluidDropdownMenuContent>
			</DropdownMenu>
		);
	}
	render(<OptionsHarness />);
	fireEvent.click(screen.getByRole("button", { name: "Options" }));
	fireEvent.click(await screen.findByText("Working copy"));
	fireEvent.click(await screen.findByText("Separate copy"));
	expect(onChange.mock.lastCall?.[0].selection).toMatchObject({
		mode: "new",
		workspace: "isolated",
		projectWork,
	});
	expect(onChange.mock.lastCall?.[0].selection.access).toBeUndefined();

	fireEvent.click(screen.getByRole("button", { name: "Options" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: TASK_ACCESS_MENU })
	);
	fireEvent.click(await screen.findByText("Project files only"));
	expect(onChange.mock.lastCall?.[0].selection).toMatchObject({
		access: "workspace",
		workspace: "isolated",
		projectWork,
	});

	fireEvent.click(screen.getByRole("button", { name: "Options" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: TASK_ACCESS_MENU })
	);
	fireEvent.click(await screen.findByText("Use agent settings"));
	expect(onChange.mock.lastCall?.[0].selection).toMatchObject({
		mode: "new",
		workspace: "isolated",
		projectWork,
	});
	expect(onChange.mock.lastCall?.[0].selection.access).toBeUndefined();
	fireEvent.click(screen.getByRole("button", { name: "Options" }));
	fireEvent.click(await screen.findByText("Session"));
	fireEvent.click(
		await screen.findByRole("menuitemradio", { name: "Automatic" })
	);
	expect(onChange.mock.lastCall?.[0].selection).toEqual({ mode: "auto" });
	for (const { label, access, workspace } of [
		{
			label: "No project files",
			access: "space_context",
			workspace: "isolated",
		},
		{ label: "Use agent settings", access: undefined, workspace: "current" },
	]) {
		fireEvent.click(screen.getByRole("button", { name: "Options" }));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: TASK_ACCESS_MENU })
		);
		fireEvent.click(await screen.findByText(label));
		expect(onChange.mock.lastCall?.[0].selection.access).toBe(access);
		expect(onChange.mock.lastCall?.[0].selection.workspace).toBe(workspace);
		expect(onChange.mock.lastCall?.[0].selection.projectWork).toBeUndefined();
	}
});

const agentTargets: SpaceComposerAddressingTarget[] = [
	["agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Engineer"],
	["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "QA"],
].map(([profileId, profileName]) => ({
	profileId: profileId ?? "",
	profileName: profileName ?? "",
	agentControllerRef: "builtin:codex",
	primaryMentionLabel: "Wake",
	allowedRelations: { wake: true, reference: true, mention: false },
	relation: "wake",
	wakeAvailability: { status: "ready", reasonCodes: [], reasonText: null },
}));

function MultiAgentHarness(input: {
	onSubmit: (options?: SpaceComposerSendOptions) => void;
}) {
	const composerRef = useRef<SpaceComposerEditorHandle>(null);
	const [draft, setDraft] = useState({
		text: "@Engineer @QA Review this.",
		authoredMentions: [
			{
				profileId: agentTargets[0]?.profileId ?? "",
				relation: "wake" as const,
				text: "@Engineer",
				start: 0,
				end: 9,
			},
			{
				profileId: agentTargets[1]?.profileId ?? "",
				relation: "wake" as const,
				text: "@QA",
				start: 10,
				end: 13,
			},
		] as ComposerDraftAuthoredMention[],
	});
	return (
		<SpaceComposer
			actions={{ onEditorChange: setDraft, onSubmit: input.onSubmit }}
			availability={{
				canSendMessage: true,
				fileLimitReached: false,
				isSendingMessage: false,
				sendBlocked: false,
			}}
			centerAgentProfileId={null}
			composerRef={composerRef}
			content={{
				...draft,
				addressingTargets: agentTargets,
				files: [],
				mentionPickerItems: [],
			}}
			context={{ conversationKind: "space", placement: "conversation" }}
		/>
	);
}

it("keeps access restrictions when starting a new session", async () => {
	const onChange = vi.fn();
	render(
		<DropdownMenu>
			<DropdownMenuTrigger>Agent options</DropdownMenuTrigger>
			<FluidDropdownMenuContent>
				<SpaceComposerAgentOptions
					choice={{
						targetProfileId: "agent",
						label: "Automatic",
						selection: {
							mode: "auto",
							access: "read_only",
							workspace: "current",
						},
					}}
					onChange={onChange}
					projectName="OpenMeld"
					sources={[]}
					supportsCurrentFolder={true}
					targetProfileId="agent"
				/>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
	fireEvent.click(screen.getByRole("button", { name: "Agent options" }));
	fireEvent.click(await screen.findByText("Session"));
	fireEvent.click(await screen.findByText("Start new"));
	expect(onChange).toHaveBeenCalledWith({
		targetProfileId: "agent",
		label: "Start new",
		selection: { mode: "new", access: "read_only", workspace: "current" },
	});
});

it("sends the chosen Project and repository fingerprint with a new task", async () => {
	const organizationId = "org-1";
	const projectId = "project-payments";
	const repositoryFingerprint = `sha256:${"a".repeat(64)}`;
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(projectQueryKeys.organization(organizationId), {
		organizationId,
		projects: [{ id: projectId, name: "Payments" }],
	});
	queryClient.setQueryData(
		projectQueryKeys.repositories(organizationId, projectId),
		{
			settings: {
				projectId,
				repositories: [
					{
						repositoryFingerprint,
						repositoryUrl: "https://github.com/amplifthq/payments",
						isDefault: true,
					},
				],
				legacyDefaultFingerprint: null,
			},
		}
	);
	const onChange = vi.fn();
	render(
		<QueryClientProvider client={queryClient}>
			<DropdownMenu>
				<DropdownMenuTrigger>Agent options</DropdownMenuTrigger>
				<FluidDropdownMenuContent>
					<SpaceComposerAgentOptions
						onChange={onChange}
						organizationId={organizationId}
						sources={[]}
						supportsCurrentFolder
						targetProfileId="agent"
					/>
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</QueryClientProvider>
	);
	fireEvent.click(screen.getByRole("button", { name: "Agent options" }));
	fireEvent.click(await screen.findByText("Working copy"));
	fireEvent.click(await screen.findByText("Choose Project…"));
	fireEvent.change(await screen.findByRole("combobox", { name: "Project" }), {
		target: { value: projectId },
	});
	fireEvent.click(
		await screen.findByRole("button", { name: "Use for new task" })
	);
	expect(onChange).toHaveBeenCalledWith({
		label: "Payments · amplifthq/payments",
		selection: {
			mode: "new",
			workspace: "isolated",
			projectWork: { projectId, repositoryFingerprint },
		},
		targetProfileId: "agent",
	});
});

describe("SpaceComposer sending focus", () => {
	it.each([
		{ placement: "conversation", method: "click", mention: false },
		{ placement: "conversation", method: "Enter", mention: true },
		{ placement: "thread", method: "click", mention: true },
	] as const)("keeps typing after $method in a $placement (mention: $mention)", async ({
		placement,
		method,
		mention,
	}) => {
		render(<SendHarness mention={mention} placement={placement} />);
		const editor = screen.getByRole("textbox");
		const send = screen.getByRole("button", {
			name: placement === "thread" ? "Send reply" : "Send message",
		});
		if (method === "click") {
			// jsdom does not implement the browser's pointer-to-button focus default.
			act(() => send.focus());
			fireEvent.click(send);
		} else {
			act(() => editor.focus());
			fireEvent.keyDown(editor, { key: "Enter" });
		}
		await waitFor(() => expect(document.activeElement).toBe(editor));
		fireEvent.paste(editor, {
			clipboardData: {
				files: [],
				items: [],
				getData: (type: string) =>
					type === "text/plain" ? "Second message" : "",
			},
		});
		await waitFor(() => expect(editor.textContent).toContain("Second message"));
		expect(editor.textContent).not.toContain("First message");
		expect(screen.queryByTestId("space-composer-profile-token")).toBeNull();
	});
});

it("only consumes a recommendation after the send owner stages a message", () => {
	const onSubmit = vi.fn<(options?: SpaceComposerSendOptions) => void>();
	const items: Partial<SpaceTimelineItem>[] = [
		{
			id: "request",
			actorProfileId: "me",
			actorProfileKind: "human",
			wakeTargetProfileIds: ["alex"],
			deliveryState: "sent",
		},
		{
			id: "reply",
			actorProfileId: "alex",
			actorProfileKind: "agent",
			wakeTargetProfileIds: [],
			deliveryState: "sent",
			wakeSourceSignalId: "request",
		},
	];
	render(
		<SpaceWakeRecommendationScope
			items={items as SpaceTimelineItem[]}
			selfProfileId="me"
		>
			<RecommendationStatus />
			<SendHarness
				mention={false}
				onSubmit={onSubmit}
				placement="conversation"
			/>
		</SpaceWakeRecommendationScope>
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	expect(screen.getByText("Recommendation available")).toBeTruthy();
	expect(screen.getByRole("textbox").textContent).toContain("First message");
	act(() => onSubmit.mock.calls[0]?.[0]?.onMessageStaged?.("exact-client-id"));
	expect(screen.queryByText("Recommendation available")).toBeNull();
	expect(screen.getByRole("textbox").textContent).toContain("First message");
});

function RecommendationStatus() {
	return useSpaceWakeRecommendation()?.candidate ? (
		<span>Recommendation available</span>
	) : null;
}

function SendHarness(input: {
	placement: "conversation" | "thread";
	mention: boolean;
	onSubmit?: (options?: SpaceComposerSendOptions) => void;
}) {
	const composerRef = useRef<SpaceComposerEditorHandle>(null);
	const [draft, setDraft] = useState<{
		text: string;
		authoredMentions: ComposerDraftAuthoredMention[];
	}>({
		text: input.mention ? "@Runner First message" : "First message",
		authoredMentions: input.mention
			? [
					{
						profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						relation: "reference",
						text: "@Runner",
						start: 0,
						end: 7,
					},
				]
			: [],
	});
	return (
		<SpaceComposer
			actions={{
				onEditorChange: (change) => setDraft(change),
				onSubmit:
					input.onSubmit ??
					(() => setDraft({ text: "", authoredMentions: [] })),
			}}
			availability={{
				canSendMessage: true,
				fileLimitReached: false,
				isSendingMessage: false,
				sendBlocked: !draft.text,
			}}
			centerAgentProfileId={null}
			composerRef={composerRef}
			content={{
				addressingTargets: [],
				authoredMentions: draft.authoredMentions,
				files: [],
				mentionPickerItems: [],
				text: draft.text,
			}}
			context={{ conversationKind: "space", placement: input.placement }}
		/>
	);
}

it("shows an observing Agent owner their Agent's questions above the read-only bar", () => {
	render(
		<SpaceComposer
			actions={{ onEditorChange: vi.fn(), onSubmit: vi.fn() }}
			availability={{
				canSendMessage: false,
				fileLimitReached: false,
				isSendingMessage: false,
				sendBlocked: false,
			}}
			centerAgentProfileId={null}
			composerRef={createRef<SpaceComposerEditorHandle>()}
			content={{
				addressingTargets: [],
				authoredMentions: [],
				files: [],
				mentionPickerItems: [],
				text: "",
			}}
			context={{
				conversationKind: "space",
				placement: "conversation",
				readOnly: true,
				readOnlyPlaceholder: "Join to participate in this Space.",
			}}
			slots={{
				pendingActionSurface: <p>Claude Code asks to run a command</p>,
			}}
		/>
	);
	expect(screen.getByText("Claude Code asks to run a command")).toBeTruthy();
	expect(screen.getByText("Join to participate in this Space.")).toBeTruthy();
});

it("stacks Agent requests, pending actions and queued messages above the input, in that order", () => {
	render(
		<SpaceComposer
			actions={{ onEditorChange: vi.fn(), onSubmit: vi.fn() }}
			availability={{
				canSendMessage: true,
				fileLimitReached: false,
				isSendingMessage: false,
				sendBlocked: true,
			}}
			centerAgentProfileId={null}
			composerRef={createRef<SpaceComposerEditorHandle>()}
			content={{
				addressingTargets: [],
				authoredMentions: [],
				files: [],
				mentionPickerItems: [],
				text: "",
			}}
			context={{ conversationKind: "space", placement: "conversation" }}
			slots={{
				agentRequests: <p>Tali asked to add Claude Code here</p>,
				pendingActionSurface: <p>1 action needs you</p>,
				queuedMessages: <p>Queued: ship it</p>,
			}}
		/>
	);
	const order = [
		screen.getByText("Tali asked to add Claude Code here"),
		screen.getByText("1 action needs you"),
		screen.getByText("Queued: ship it"),
		screen.getByRole("textbox"),
	];
	for (const [index, element] of order.slice(1).entries()) {
		expect(order[index]?.compareDocumentPosition(element)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	}
});

function readOnlyComposer(context: {
	accessPending?: boolean;
	readOnly?: boolean;
	readOnlyPlaceholder?: string;
}) {
	return (
		<SpaceComposer
			actions={{ onEditorChange: vi.fn(), onSubmit: vi.fn() }}
			availability={{
				canSendMessage: false,
				fileLimitReached: false,
				isSendingMessage: false,
				sendBlocked: false,
			}}
			centerAgentProfileId={null}
			composerRef={createRef<SpaceComposerEditorHandle>()}
			content={{
				addressingTargets: [],
				authoredMentions: [],
				files: [],
				mentionPickerItems: [],
				text: "",
			}}
			context={{
				conversationKind: "space",
				placement: "conversation",
				...context,
			}}
			slots={{
				agentRequests: <p>Tali wants to use Codex</p>,
				primaryAction: <button type="button">Join</button>,
			}}
		/>
	);
}

it("shows a neutral bar, never the input, while membership is loading", () => {
	render(readOnlyComposer({ accessPending: true }));
	expect(screen.queryByRole("textbox")).toBeNull();
	expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
	const bar = document.querySelector(
		'[data-slot="space-composer-read-only-bar"]'
	);
	expect(bar?.getAttribute("aria-busy")).toBe("true");
});

it("keeps Agent request trays above the Join bar so the bar covers their foot", () => {
	render(
		readOnlyComposer({
			readOnly: true,
			readOnlyPlaceholder: "Join this conversation to send messages.",
		})
	);
	const tray = screen.getByText("Tali wants to use Codex");
	const bar = document.querySelector(
		'[data-slot="space-composer-read-only-bar"]'
	) as HTMLElement;
	expect(tray.compareDocumentPosition(bar)).toBe(
		Node.DOCUMENT_POSITION_FOLLOWING
	);
	// The bar paints over the tray's tucked foot instead of under it.
	expect(bar.className).toContain("relative");
	expect(bar.className).toContain("bg-background");
	expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import {
	SPACE_RESPONSE_TRUNCATED_MARKER,
	SPACE_RESPONSE_TRUNCATED_SUFFIX,
	SpaceMessageBody,
} from "./space-message-body";
import { SPACE_MESSAGE_LOCAL_COLLAPSE_THRESHOLD_CHARS } from "./space-message-collapse";

const SHOW_FULL_MESSAGE_PATTERN = /show full message/i;
const INTERNAL_ACTION_CATALOG_PATTERN = /action catalog/i;
const REFERENCED_SPACE_ID = "a".repeat(64);
const WAKE_TARGET_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const WAKE_TARGET_PROFILE_NAME = "Production Smoke Codex — Aug 28";
const REFERENCE_TARGET_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const REFERENCE_TARGET_PROFILE_NAME = "Review Agent";

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
}));

vi.mock("./center-agent-computer-setup-card", () => ({
	CenterAgentComputerSetupCard: () => (
		<section data-slot="computer-setup-flow">Computer setup</section>
	),
}));

describe("SpaceMessageBody", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("omits the body wrapper when the message has no visible content", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: "",
				}}
			/>
		);

		expect(view.container.childElementCount).toBe(0);
	});

	it("never renders private model reasoning as message content", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId: "stream-private-reasoning",
						thinking:
							'The action catalog returned no match for "unread inbox count".',
					},
					isAgentFinalReply: true,
					text: "",
				}}
			/>
		);

		expect(view.container.childElementCount).toBe(0);
		expect(screen.queryByText(INTERNAL_ACTION_CATALOG_PATTERN)).toBeNull();
	});

	it("recognizes links in human messages while preserving other Markdown as plain text", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: "**bold** and [Docs](https://example.com/docs)",
				}}
			/>
		);

		expect(screen.getByText("**bold** and", { exact: false })).toBeTruthy();
		const link = screen.getByRole("link", { name: "Docs" });
		expect(link.getAttribute("href")).toBe("https://example.com/docs");
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toBe("noopener noreferrer");
	});

	it("makes bare links clickable without treating code or dangerous schemes as links", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: "See https://example.com. `https://code.example.com` [bad](javascript:alert(1))",
				}}
			/>
		);
		expect(screen.getAllByRole("link")).toHaveLength(1);
		expect(screen.getByRole("link").getAttribute("href")).toBe(
			"https://example.com/"
		);
	});

	it.each([
		false,
		true,
	])("preserves a Human mention token without Agent actions (Markdown: %s)", (isAgentFinalReply) => {
		const profileId = "11111111-1111-4111-8111-111111111111";
		const onOpenProfile = vi.fn();
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply,
					text: "@MingYoo hello",
					mentionTargetProfileIds: [profileId],
				}}
				onOpenProfile={onOpenProfile}
				profilePresentationsById={
					new Map([
						[
							profileId,
							{
								agentControllerRef: null,
								avatarImageUrl: null,
								isCenterAgent: false,
								profileId,
								profileKind: "human",
								profileName: "MingYoo",
							},
						],
					])
				}
			/>
		);
		const token = screen.getByRole("button", { name: "Open MingYoo profile" });
		expect(within(token).getByText("MingYoo")).toBeTruthy();
		expect(within(token).queryByText("Mention only")).toBeNull();
		expect(within(token).queryByText("Wake")).toBeNull();
		fireEvent.click(token);
		expect(onOpenProfile).toHaveBeenCalledWith(profileId);
	});

	it("renders a structured Wake target as a compact clickable Agent token", () => {
		const onOpenProfile = vi.fn();
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `@${WAKE_TARGET_PROFILE_NAME} hi`,
					wakeTargetProfileIds: [WAKE_TARGET_PROFILE_ID],
				}}
				onOpenProfile={onOpenProfile}
				profilePresentationsById={createWakeTargetProfilePresentations()}
			/>
		);

		const mention = view.container.querySelector(
			'[data-slot="space-message-profile-mention"]'
		);

		const mentionButton = screen.getByRole("button", {
			name: `Open ${WAKE_TARGET_PROFILE_NAME} profile (Wake)`,
		});
		expect(mentionButton).toBe(mention);
		expect(mentionButton.className).toContain("items-center");
		expect(mentionButton.className).toContain("gap-1");
		expect(mentionButton.className).toContain("align-baseline");
		const atMark = mention?.querySelector('[aria-hidden="true"]');
		expect(atMark?.textContent).toBe("@");
		expect(mention?.childNodes.item(2).textContent).toBe(
			WAKE_TARGET_PROFILE_NAME
		);
		const profileIcon = screen.getByTestId(
			`space-profile-icon-${WAKE_TARGET_PROFILE_ID}`
		);
		expect(profileIcon.className).not.toContain("me-");
		const profileName = screen.getByText(WAKE_TARGET_PROFILE_NAME);
		expect(profileName.tagName).toBe("STRONG");
		expect(profileName.className).toContain("font-semibold");
		expect(profileName.className).not.toContain("underline");
		expect(profileName.className).not.toContain("font-bold");
		expect(within(mentionButton).getByText("Wake")).toBeTruthy();
		expect(mention?.nextSibling?.textContent).toBe(" hi");

		fireEvent.click(mentionButton);
		expect(onOpenProfile).toHaveBeenCalledOnce();
		expect(onOpenProfile).toHaveBeenCalledWith(WAKE_TARGET_PROFILE_ID);
	});

	it.each([
		false,
		true,
	])("renders a structured ID mention using its display name (Markdown: %s)", (isAgentFinalReply) => {
		const profileName = "Felix Lu Codex GPT-5.6 Sol (1)";
		const profiles = new Map<string, SpaceCollaborationProfilePresentation>(
			createWakeTargetProfilePresentations()
		);
		const profile = profiles.get(WAKE_TARGET_PROFILE_ID);
		if (!profile) {
			throw new Error("Missing Wake target fixture");
		}
		profiles.set(WAKE_TARGET_PROFILE_ID, { ...profile, profileName });
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply,
					text: `@${WAKE_TARGET_PROFILE_ID} hi`,
					wakeTargetProfileIds: [WAKE_TARGET_PROFILE_ID],
				}}
				profilePresentationsById={profiles}
			/>
		);
		expect(view.container.textContent).toContain(profileName);
		expect(view.container.textContent).not.toContain(WAKE_TARGET_PROFILE_ID);
	});

	it("renders a structured Agent Reference with the same profile-details behavior", () => {
		const onOpenProfile = vi.fn();
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					referenceTargetProfileIds: [REFERENCE_TARGET_PROFILE_ID],
					text: `Ask @${REFERENCE_TARGET_PROFILE_NAME} for context.`,
					wakeTargetProfileIds: [],
				}}
				onOpenProfile={onOpenProfile}
				profilePresentationsById={createWakeTargetProfilePresentations()}
			/>
		);

		const referenceButton = screen.getByRole("button", {
			name: `Open ${REFERENCE_TARGET_PROFILE_NAME} profile (Mention only)`,
		});
		expect(within(referenceButton).getByText("Mention only")).toBeTruthy();
		fireEvent.click(referenceButton);
		expect(onOpenProfile).toHaveBeenCalledWith(REFERENCE_TARGET_PROFILE_ID);
	});

	it("keeps repeated structured Agent appearances explicit after sending", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `@${WAKE_TARGET_PROFILE_NAME} leads; @${WAKE_TARGET_PROFILE_NAME} is referenced again.`,
					wakeTargetProfileIds: [WAKE_TARGET_PROFILE_ID],
				}}
				profilePresentationsById={createWakeTargetProfilePresentations()}
			/>
		);

		expect(
			view.container.querySelectorAll(
				'[data-slot="space-message-profile-mention"]'
			)
		).toHaveLength(2);
		expect(
			screen.getByText("Wake", {
				selector: '[data-slot="space-message-profile-mention"] span',
			})
		).toBeTruthy();
		expect(
			screen.getByText("Mention only", {
				selector: '[data-slot="space-message-profile-mention"] span',
			})
		).toBeTruthy();
	});

	it("keeps an ordinary unstructured @Agent name as plain text", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `@${WAKE_TARGET_PROFILE_NAME} hi`,
					wakeTargetProfileIds: [],
				}}
				profilePresentationsById={createWakeTargetProfilePresentations()}
			/>
		);

		expect(
			view.container.querySelector(
				'[data-slot="space-message-profile-mention"]'
			)
		).toBeNull();
		const humanMessage = screen.getByText(`@${WAKE_TARGET_PROFILE_NAME} hi`);
		expect(humanMessage.tagName).toBe("P");
		expect(humanMessage.classList.contains("content-space-message")).toBe(true);
		expect(view.container.querySelector(".typeset")).toBeNull();
	});

	it("renders Markdown for ordinary Agent-authored Space messages", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					actorProfileKind: "agent",
					isAgentFinalReply: false,
					text: "## Review\n\n**Accepted**\n\n- Run the smoke test",
				}}
			/>
		);

		expect(
			screen.getByRole("heading", { level: 2, name: "Review" })
		).toBeTruthy();
		expect(screen.getByText("Accepted").tagName).toBe("STRONG");
		expect(screen.getByText("Run the smoke test").tagName).toBe("LI");
		const messageBody = view.container.querySelector(
			'[data-typeset-variant="space-message"]'
		);
		expect(messageBody?.classList.contains("typeset")).toBe(true);
		expect(messageBody?.classList.contains("typeset-space-message")).toBe(true);
		expect(messageBody?.classList.contains("content-space-message")).toBe(true);
	});

	it("renders a structured Wake target without breaking Agent Markdown", () => {
		render(
			<SpaceMessageBody
				item={{
					actorProfileKind: "agent",
					isAgentFinalReply: false,
					text: `**Review:** @${WAKE_TARGET_PROFILE_NAME} please inspect this.`,
					wakeTargetProfileIds: [WAKE_TARGET_PROFILE_ID],
				}}
				profilePresentationsById={createWakeTargetProfilePresentations()}
			/>
		);

		expect(screen.getByText("Review:").tagName).toBe("STRONG");
		expect(screen.getByText(WAKE_TARGET_PROFILE_NAME).tagName).toBe("STRONG");
		expect(
			screen.getByTestId(`space-profile-icon-${WAKE_TARGET_PROFILE_ID}`)
		).toBeTruthy();
	});

	it("keeps structured Agent names inside Markdown code and links unchanged", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					actorProfileKind: "agent",
					isAgentFinalReply: false,
					text: [
						`\`@${WAKE_TARGET_PROFILE_NAME}\``,
						`[docs for @${WAKE_TARGET_PROFILE_NAME}](https://example.com/docs)`,
						`\`\`\`text\n@${WAKE_TARGET_PROFILE_NAME}\n\`\`\``,
						`@${WAKE_TARGET_PROFILE_NAME} please inspect this.`,
					].join("\n\n"),
					wakeTargetProfileIds: [WAKE_TARGET_PROFILE_ID],
				}}
				profilePresentationsById={createWakeTargetProfilePresentations()}
			/>
		);

		expect(
			view.container.querySelectorAll(
				'[data-slot="space-message-profile-mention"]'
			)
		).toHaveLength(1);
		expect(
			screen
				.getByRole("link", {
					name: `docs for @${WAKE_TARGET_PROFILE_NAME}`,
				})
				.getAttribute("href")
		).toBe("https://example.com/docs");
		expect(screen.getAllByText(`@${WAKE_TARGET_PROFILE_NAME}`)).toHaveLength(2);
	});

	it("renders an accessible Space reference in a human-authored message", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `Open /spaces/${REFERENCED_SPACE_ID} next.`,
				}}
				spaceReferencesById={createResolvedSpaceReferences()}
			/>
		);

		const link = screen.getByRole("link", {
			name: "Open Space Launch Planning",
		});

		expect(link.getAttribute("href")).toBe(`/spaces/${REFERENCED_SPACE_ID}`);
		expect(link.getAttribute("target")).toBeNull();
		expect(screen.getByText("Launch Planning")).toBeTruthy();
	});

	it("uses the authenticated Organization Space route when the resolved reference provides it", () => {
		const href = `/o/acme/spaces/${REFERENCED_SPACE_ID}?profileId=profile-1`;
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `Open /spaces/${REFERENCED_SPACE_ID} next.`,
				}}
				spaceReferencesById={
					new Map([
						[
							REFERENCED_SPACE_ID,
							{
								href,
								name: "Launch Planning",
								spaceId: REFERENCED_SPACE_ID,
							},
						],
					])
				}
			/>
		);

		expect(
			screen
				.getByRole("link", { name: "Open Space Launch Planning" })
				.getAttribute("href")
		).toBe(href);
	});

	it("keeps legacy singular Space references clickable through the canonical route", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `/space/${REFERENCED_SPACE_ID}`,
				}}
				spaceReferencesById={createResolvedSpaceReferences()}
			/>
		);

		expect(
			screen
				.getByRole("link", { name: "Open Space Launch Planning" })
				.getAttribute("href")
		).toBe(`/spaces/${REFERENCED_SPACE_ID}`);
	});

	it("recognizes a Space reference next to ordinary sentence punctuation", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `See (/spaces/${REFERENCED_SPACE_ID}).`,
				}}
				spaceReferencesById={createResolvedSpaceReferences()}
			/>
		);

		expect(
			screen.getByRole("link", { name: "Open Space Launch Planning" })
		).toBeTruthy();
	});

	it("normalizes uppercase hexadecimal Space references", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `/spaces/${REFERENCED_SPACE_ID.toUpperCase()}`,
				}}
				spaceReferencesById={createResolvedSpaceReferences()}
			/>
		);

		expect(
			screen
				.getByRole("link", { name: "Open Space Launch Planning" })
				.getAttribute("href")
		).toBe(`/spaces/${REFERENCED_SPACE_ID}`);
	});

	it("keeps unresolved and malformed Space paths as plain text", () => {
		const unresolvedPath = `/spaces/${"b".repeat(64)}`;
		const tooShortPath = `/spaces/${"c".repeat(63)}`;
		const tooLongPath = `/spaces/${"d".repeat(65)}`;
		const externalUrls = [
			`https://example.com/spaces/${REFERENCED_SPACE_ID}`,
			`https://example.com//spaces/${REFERENCED_SPACE_ID}`,
			`https://example.com/?next=/spaces/${REFERENCED_SPACE_ID}`,
			`https://example.com./spaces/${REFERENCED_SPACE_ID}`,
			`https://[::1]/spaces/${REFERENCED_SPACE_ID}`,
			`https://例子.测试/spaces/${REFERENCED_SPACE_ID}`,
			`/spaces/${REFERENCED_SPACE_ID}/activity`,
			`/spaces/${REFERENCED_SPACE_ID}.json`,
			`label_/spaces/${REFERENCED_SPACE_ID}`,
			`/spaces/${REFERENCED_SPACE_ID}-extra`,
			`/spaces/${REFERENCED_SPACE_ID}_extra`,
		];
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: [
						unresolvedPath,
						tooShortPath,
						tooLongPath,
						...externalUrls,
					].join("\n"),
				}}
				spaceReferencesById={createResolvedSpaceReferences()}
			/>
		);

		expect(
			screen.queryByRole("link", { name: "Open Space Launch Planning" })
		).toBeNull();
		expect(
			screen
				.getAllByRole("link")
				.every((link) => link.getAttribute("href")?.startsWith("https://"))
		).toBe(true);
		expect(view.container.textContent).toContain(unresolvedPath);
		expect(view.container.textContent).toContain(tooShortPath);
		expect(view.container.textContent).toContain(tooLongPath);
		for (const externalUrl of externalUrls) {
			expect(view.container.textContent).toContain(externalUrl);
		}
	});

	it("uses a shortened ID when a resolved Space has no name", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `/spaces/${REFERENCED_SPACE_ID}`,
				}}
				spaceReferencesById={createResolvedSpaceReferences(null)}
			/>
		);

		expect(
			screen.getByRole("link", { name: "Open Space aaaaaaaa…aaaa" })
		).toBeTruthy();
	});

	it("allows self message text and controls to align to the right", () => {
		const view = render(
			<SpaceMessageBody
				className="text-right"
				containerClassName="items-end text-right"
				item={{
					isAgentFinalReply: false,
					text: "hello",
				}}
			/>
		);

		const bodyContainer = view.container.firstElementChild;

		expect(bodyContainer?.className).toContain("items-end");
		expect(bodyContainer?.className).toContain("text-right");
		expect(screen.getByText("hello").className).toContain("text-right");
	});

	it("renders Markdown for agent final replies only", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: "**bold**\n\n- first\n- second",
				}}
			/>
		);

		expect(screen.getByText("bold")).toBeTruthy();
		expect(screen.queryByText("**bold**")).toBeNull();
		expect(screen.getByText("first").tagName).toBe("LI");
		expect(screen.getByText("second").tagName).toBe("LI");
		const messageBody = view.container.querySelector(
			'[data-typeset-variant="space-message"]'
		);
		expect(messageBody?.classList.contains("typeset")).toBe(true);
		expect(messageBody?.classList.contains("typeset-space-message")).toBe(true);
		expect(messageBody?.classList.contains("content-space-message")).toBe(true);
	});

	it("animates words while an agent reply is streaming", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId: "stream-1",
					},
					isAgentFinalReply: true,
					text: "Words arrive smoothly",
				}}
			/>
		);

		expect(
			view.container.querySelectorAll("span[data-sd-animate]").length
		).toBeGreaterThan(0);
	});

	it("paces newly accumulated agent text instead of revealing the whole snapshot", async () => {
		vi.useFakeTimers();
		const view = render(
			<SpaceMessageBody
				item={{
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId: "stream-1",
					},
					isAgentFinalReply: true,
					text: "I found ",
				}}
			/>
		);

		view.rerender(
			<SpaceMessageBody
				item={{
					agentStreamState: {
						reasonCode: null,
						sequence: 2,
						status: "streaming",
						streamId: "stream-1",
					},
					isAgentFinalReply: true,
					text: "I found the problem in the stream.",
				}}
			/>
		);

		expect(view.container.textContent).toContain("I found");
		expect(view.container.textContent).not.toContain(
			"I found the problem in the stream."
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(20);
		});
		expect(view.container.textContent).toContain("I found the");
		expect(view.container.textContent).not.toContain(
			"I found the problem in the stream."
		);

		for (let step = 0; step < 10; step += 1) {
			await act(async () => {
				await vi.advanceTimersByTimeAsync(20);
			});
		}
		expect(view.container.textContent).toContain(
			"I found the problem in the stream."
		);
	});

	it("shows the complete accumulated text immediately when the stream ends", () => {
		vi.useFakeTimers();
		const view = render(
			<SpaceMessageBody
				item={{
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId: "stream-1",
					},
					isAgentFinalReply: true,
					text: "Working ",
				}}
			/>
		);

		view.rerender(
			<SpaceMessageBody
				item={{
					agentStreamState: {
						reasonCode: null,
						sequence: 2,
						status: "streaming",
						streamId: "stream-1",
					},
					isAgentFinalReply: true,
					text: "Working through the remaining details.",
				}}
			/>
		);

		expect(view.container.textContent).not.toContain(
			"Working through the remaining details."
		);

		view.rerender(
			<SpaceMessageBody
				item={{
					agentStreamState: {
						reasonCode: "agent_stopped",
						sequence: 3,
						status: "stopped",
						streamId: "stream-1",
					},
					isAgentFinalReply: true,
					text: "Working through the remaining details.",
				}}
			/>
		);

		expect(view.container.textContent).toContain(
			"Working through the remaining details."
		);
		expect(view.container.querySelector("[data-sd-animate]")).toBeNull();
	});

	it("shows accumulated text immediately when reduced motion is enabled", () => {
		vi.useFakeTimers();
		const view = render(
			<MotionConfig reducedMotion="always">
				<SpaceMessageBody
					item={{
						agentStreamState: {
							reasonCode: null,
							sequence: 1,
							status: "streaming",
							streamId: "stream-1",
						},
						isAgentFinalReply: true,
						text: "I found ",
					}}
				/>
			</MotionConfig>
		);

		view.rerender(
			<MotionConfig reducedMotion="always">
				<SpaceMessageBody
					item={{
						agentStreamState: {
							reasonCode: null,
							sequence: 2,
							status: "streaming",
							streamId: "stream-1",
						},
						isAgentFinalReply: true,
						text: "I found the problem in the stream.",
					}}
				/>
			</MotionConfig>
		);

		expect(view.container.textContent).toContain(
			"I found the problem in the stream."
		);
	});

	it("leaves no animation spans in a completed agent reply", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: "Completed replies stay lightweight",
				}}
			/>
		);

		expect(view.container.querySelector("[data-sd-animate]")).toBeNull();
	});

	it("does not animate text inside a streaming code block", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					agentStreamState: {
						reasonCode: null,
						sequence: 1,
						status: "streaming",
						streamId: "stream-1",
					},
					isAgentFinalReply: true,
					text: 'Before\n\n```ts\nconst chunk = "inside code";\n```\n\nAfter',
				}}
			/>
		);

		expect(view.container.querySelector("[data-sd-animate]")).toBeTruthy();
		expect(view.container.querySelector("code [data-sd-animate]")).toBeNull();
	});

	it("wraps Markdown tables in the shape-aware typeset scroll container", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: "| Name | Status |\n| --- | --- |\n| OpenMeld | Ready |",
				}}
			/>
		);

		const scrollContainer = view.container.querySelector(".typeset-scroll");
		expect(scrollContainer?.querySelector("table")).toBeTruthy();
		expect(scrollContainer?.classList.contains("w-fit")).toBe(true);
		expect(scrollContainer?.classList.contains("max-w-full")).toBe(true);
		expect(scrollContainer?.classList.contains("rounded-md")).toBe(true);
	});

	it("renders a resolved Space reference without breaking agent Markdown", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: `**Created:** /spaces/${REFERENCED_SPACE_ID}`,
				}}
				spaceReferencesById={createResolvedSpaceReferences()}
			/>
		);

		expect(screen.getByText("Created:").tagName).toBe("STRONG");
		expect(
			screen.getByRole("link", { name: "Open Space Launch Planning" })
		).toBeTruthy();
	});

	it("renders a trusted Navigation Action as a button link", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					navigationAction: {
						label: "Open this Project",
						target: { kind: "project", projectId: "project_123" },
						url: "http://localhost:5173/o/acme/projects/project_123",
					},
					text: "Project created.",
				}}
			/>
		);

		const action = screen.getByRole("link", { name: "Open this Project" });
		expect(action.getAttribute("href")).toBe(
			"http://localhost:5173/o/acme/projects/project_123"
		);
		expect(action.getAttribute("data-slot")).toBe("navigation-action");
		expect(action.getAttribute("target")).toBeNull();
	});

	it("renders computer setup inline only with trusted Center Agent conversation context", () => {
		const view = render(
			<SpaceMessageBody
				computerSetupContext={{
					orgSlug: "acme",
					profileId: "human_profile_1",
					spaceId: "center_agent_dm_1",
				}}
				item={{
					isAgentFinalReply: true,
					navigationAction: {
						label: "Reconnect this computer",
						target: {
							connectedComputerId: "computer_1",
							kind: "computer_setup",
							mode: "reconnect",
						},
						url: "http://localhost:5173/o/acme/connect?connectedComputerId=computer_1&session=fresh",
					},
					text: "Let's reconnect this computer.",
				}}
			/>
		);

		expect(
			view.container.querySelector('[data-slot="computer-setup-flow"]')
		).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: "Reconnect this computer" })
		).toBeNull();
	});

	it("keeps computer setup as a trusted link outside a Center Agent conversation", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					navigationAction: {
						label: "Connect this computer",
						target: {
							kind: "computer_setup",
							mode: "setup",
						},
						url: "http://localhost:5173/o/acme/connect",
					},
					text: "Connect this computer to continue.",
				}}
			/>
		);

		expect(
			screen
				.getByRole("link", { name: "Connect this computer" })
				.getAttribute("href")
		).toBe("http://localhost:5173/o/acme/connect");
	});

	it("does not let assistant Markdown impersonate a Navigation Action button", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: "[Open this Project](https://example.com/fake)",
				}}
			/>
		);

		const link = screen.getByRole("link", { name: "Open this Project" });
		expect(link.getAttribute("data-slot")).toBeNull();
		expect(link.getAttribute("target")).toBe("_blank");
	});

	it("does not turn Space paths inside agent code into links", () => {
		const path = `/spaces/${REFERENCED_SPACE_ID}`;
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: `Inline: \`${path}\`\n\n\`\`\`text\n${path}\n\`\`\``,
				}}
				spaceReferencesById={createResolvedSpaceReferences()}
			/>
		);

		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getAllByText(path)).toHaveLength(2);
	});

	it("opens allowed links in a new tab and strips unsafe links", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: "[Docs](https://example.com/docs) [Email](mailto:help@example.com) [Bad](javascript:alert(1))",
				}}
			/>
		);

		const docsLink = screen.getByRole("link", { name: "Docs" });
		const emailLink = screen.getByRole("link", { name: "Email" });
		const badText = screen.getByText("Bad");

		expect(docsLink.getAttribute("href")).toBe("https://example.com/docs");
		expect(docsLink.getAttribute("target")).toBe("_blank");
		expect(docsLink.getAttribute("rel")).toBe("noopener noreferrer");
		expect(emailLink.getAttribute("href")).toBe("mailto:help@example.com");
		expect(badText.closest("a")).toBeNull();
	});

	it("keeps an unresolved internal Markdown link non-clickable", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: `[Private Space](/spaces/${REFERENCED_SPACE_ID})`,
				}}
				spaceReferencesById={new Map()}
			/>
		);

		expect(screen.getByText("Private Space").closest("a")).toBeNull();
	});

	it("does not render Markdown images or raw HTML", () => {
		render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: '![alt](https://example.com/image.png)\n\n<strong data-testid="raw-html">raw</strong>',
				}}
			/>
		);

		expect(screen.queryByRole("img")).toBeNull();
		expect(screen.queryByTestId("raw-html")).toBeNull();
		expect(screen.getByText("raw").closest("strong")).toBeNull();
	});

	it("renders structured image attachments with authenticated download links", () => {
		render(
			<SpaceMessageBody
				item={{
					attachments: [
						{
							fileName: "diagram.png",
							height: 600,
							id: "attachment-diagram",
							localPreviewUrl: null,
							mimeType: "image/png",
							sizeBytes: 2048,
							width: 800,
						},
						{
							fileName: "photo.jpg",
							height: 900,
							id: "attachment-photo",
							localPreviewUrl: "blob:photo-preview",
							mimeType: "image/jpeg",
							sizeBytes: 4096,
							width: 1200,
						},
					],
					isAgentFinalReply: false,
					spaceId: "space-123",
					text: "Here are the images.",
				}}
				orgSlug="acme"
			/>
		);

		expect(screen.getByLabelText("2 attached images")).toBeTruthy();
		expect(
			screen.getByRole("img", { name: "diagram.png" }).getAttribute("src")
		).toBe(
			"/v1/spaces/space-123/attachments/attachment-diagram?__openmeld_organization_slug=acme"
		);
		expect(
			screen.getByRole("img", { name: "photo.jpg" }).getAttribute("src")
		).toBe("blob:photo-preview");
		const photoTrigger = screen.getByRole("button", {
			name: "Open photo.jpg",
		});
		expect(photoTrigger.getAttribute("type")).toBe("button");
		expect(photoTrigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("opens an attachment image in a dialog instead of navigating away", () => {
		render(
			<SpaceMessageBody
				item={{
					attachments: [
						{
							fileName: "photo.jpg",
							height: 900,
							id: "attachment-photo",
							localPreviewUrl: "blob:photo-preview",
							mimeType: "image/jpeg",
							sizeBytes: 4096,
							width: 1200,
						},
					],
					isAgentFinalReply: false,
					spaceId: "space-123",
					text: "Here is the image.",
				}}
				orgSlug="acme"
			/>
		);

		expect(screen.queryByRole("dialog")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Open photo.jpg" }));

		expect(
			within(screen.getByRole("dialog", { name: "photo.jpg" }))
				.getByRole("img", { name: "photo.jpg" })
				.getAttribute("src")
		).toBe("blob:photo-preview");
		const originalLink = screen.getByRole("link", { name: "Open original" });
		expect(originalLink.getAttribute("href")).toBe(
			"/v1/spaces/space-123/attachments/attachment-photo?__openmeld_organization_slug=acme"
		);
		expect(originalLink.getAttribute("target")).toBe("_blank");
		expect(originalLink.getAttribute("rel")).toBe("noreferrer");

		fireEvent.keyDown(document, { key: "Escape" });
		expect(document.body.classList.contains("overflow-hidden")).toBe(false);
	});

	it("keeps canonical Space image files as morphing image previews", () => {
		const onOpenSpaceFile = vi.fn();
		render(
			<QueryClientProvider client={new QueryClient()}>
				<SpaceMessageBody
					item={{
						files: [
							{
								fileId: "file-photo",
								localPreviewUrl: "blob:space-photo-preview",
								mimeType: "image/png",
								name: "launch-photo.png",
								revision: 2,
								sizeBytes: 4096,
							},
						],
						isAgentFinalReply: false,
						spaceId: "space-123",
						text: "",
					}}
					onOpenSpaceFile={onOpenSpaceFile}
				/>
			</QueryClientProvider>
		);

		const preview = screen.getByRole("img", { name: "launch-photo.png" });
		expect(preview.getAttribute("src")).toBe("blob:space-photo-preview");
		expect(screen.queryByText("Version 2")).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: "Open launch-photo.png" })
		);

		expect(screen.getByRole("dialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open in Files" }));
		expect(onOpenSpaceFile).toHaveBeenCalledWith("file-photo", 2);
	});

	it("replaces a broken attachment image with a stable placeholder", () => {
		render(
			<SpaceMessageBody
				item={{
					attachments: [
						{
							fileName: "broken.jpg",
							id: "attachment-broken",
							localPreviewUrl: null,
							mimeType: "image/jpeg",
							sizeBytes: 2048,
						},
					],
					isAgentFinalReply: false,
					spaceId: "space-123",
					text: "This image may fail.",
				}}
			/>
		);

		fireEvent.error(screen.getByRole("img", { name: "broken.jpg" }));

		expect(screen.getByText("Image unavailable")).toBeTruthy();
		expect(screen.queryByRole("img", { name: "broken.jpg" })).toBeNull();
	});

	it("locally collapses long complete messages with Show more and Show less", () => {
		const hiddenTail = "Hidden tail";
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: false,
					text: `${"x".repeat(SPACE_MESSAGE_LOCAL_COLLAPSE_THRESHOLD_CHARS)}\n\n${hiddenTail}`,
				}}
			/>
		);

		expect(view.container.textContent).not.toContain(hiddenTail);

		fireEvent.click(screen.getByRole("button", { name: "Show more" }));

		expect(view.container.textContent).toContain(hiddenTail);
		expect(
			screen
				.getByRole("button", { name: "Show less" })
				.getAttribute("aria-expanded")
		).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "Show less" }));

		expect(view.container.textContent).not.toContain(hiddenTail);
		expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
	});

	it("renders the server truncation marker as an independent notice", () => {
		const view = render(
			<SpaceMessageBody
				item={{
					isAgentFinalReply: true,
					text: `Visible answer${SPACE_RESPONSE_TRUNCATED_SUFFIX}`,
				}}
			/>
		);

		expect(screen.getByText("Visible answer")).toBeTruthy();
		expect(view.container.textContent).not.toContain(
			SPACE_RESPONSE_TRUNCATED_MARKER
		);
		expect(
			screen.getByText(
				"OpenMeld shortened this reply because it reached the message limit."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: SHOW_FULL_MESSAGE_PATTERN })
		).toBeNull();
	});
});

function createResolvedSpaceReferences(
	name: string | null = "Launch Planning"
) {
	return new Map([
		[REFERENCED_SPACE_ID, { name, spaceId: REFERENCED_SPACE_ID }] as const,
	]);
}

function createWakeTargetProfilePresentations() {
	return new Map([
		[
			WAKE_TARGET_PROFILE_ID,
			{
				agentControllerRef: "builtin:codex",
				avatarImageUrl: null,
				isCenterAgent: false,
				profileId: WAKE_TARGET_PROFILE_ID,
				profileKind: "agent" as const,
				profileName: WAKE_TARGET_PROFILE_NAME,
			},
		] as const,
		[
			REFERENCE_TARGET_PROFILE_ID,
			{
				agentControllerRef: "builtin:codex",
				avatarImageUrl: null,
				isCenterAgent: false,
				profileId: REFERENCE_TARGET_PROFILE_ID,
				profileKind: "agent" as const,
				profileName: REFERENCE_TARGET_PROFILE_NAME,
			},
		] as const,
	]);
}

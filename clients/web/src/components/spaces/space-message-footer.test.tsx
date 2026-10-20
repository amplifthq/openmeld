import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render as renderComponent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveToolbarPosition,
	SpaceMessageFooter,
	type SpaceMessageFooterAddressingTarget,
} from "./space-message-footer";

import { MessageReactionsProvider } from "./space-message-reactions";

vi.mock("@phosphor-icons/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("@phosphor-icons/react")>()),
	ArrowBendUpLeftIcon: () => <span />,
	CaretRightIcon: () => <span />,
	ChatCircleIcon: () => <span />,
	CheckIcon: () => <span />,
	CopyIcon: () => <span />,
	DotsThreeIcon: () => <span />,
	InfoIcon: () => <span data-testid="details-info" />,
	TargetIcon: () => <span data-testid="addressing-target" />,
	WarningCircleIcon: (props: Record<string, unknown>) => (
		<span {...props} data-testid="details-warning" />
	),
}));

function render(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return renderComponent(
		<QueryClientProvider client={queryClient}>
			<MessageReactionsProvider>{children}</MessageReactionsProvider>
		</QueryClientProvider>
	);
}

const WAKE_TARGET: SpaceMessageFooterAddressingTarget = {
	agentControllerRef: "codex",
	avatarImageUrl: null,
	isCenterAgent: false,
	profileId: "agent-codex",
	profileKind: "agent",
	profileName: "Review Codex",
};

function rect(left: number, top: number, width: number, height: number) {
	return {
		bottom: top + height,
		height,
		left,
		right: left + width,
		top,
		width,
	} as DOMRect;
}

describe("floating message actions position", () => {
	afterEach(() => {
		cleanup();
		delete document.documentElement.dataset.spaceSelfMessageAlignment;
	});

	it("follows a long message's lower visible edge after its top scrolls away", () => {
		const viewport = rect(0, 0, 600, 600);
		const toolbar = rect(0, 0, 180, 28);
		const bubble = rect(100, -300, 300, 1200);
		const container = rect(0, -300, 600, 1200);
		const position = resolveToolbarPosition({
			bubble,
			container,
			preferredSide: "after",
			toolbar,
			viewport,
		});

		expect(position.placement).toBe("after");
		expect(position.left).toBe(406);
		expect(position.top + container.top).toBe(564);

		const fullWidthPosition = resolveToolbarPosition({
			bubble: rect(0, -300, 600, 1200),
			container,
			preferredSide: "before",
			toolbar,
			viewport,
		});
		expect(fullWidthPosition.placement).toBe("overlay");
		expect(fullWidthPosition.top + container.top).toBe(564);

		const visibleEndContainer = rect(0, -300, 600, 720);
		const visibleEndPosition = resolveToolbarPosition({
			bubble: rect(100, -300, 300, 720),
			container: visibleEndContainer,
			preferredSide: "after",
			toolbar,
			viewport,
		});
		expect(visibleEndPosition.top + visibleEndContainer.top).toBe(392);

		const visibleFullWidthEnd = resolveToolbarPosition({
			bubble: rect(0, -300, 600, 720),
			container: visibleEndContainer,
			preferredSide: "after",
			toolbar,
			viewport,
		});
		expect(visibleFullWidthEnd.placement).toBe("overlay");
		expect(visibleFullWidthEnd.top + visibleEndContainer.top).toBe(410);
	});

	it("centers a side-placed toolbar on the first text line when asked", () => {
		const toolbar = rect(0, 0, 28, 28);
		const container = rect(0, 100, 600, 44);
		const bubble = rect(300, 100, 280, 44);

		const atBubbleTop = resolveToolbarPosition({
			bubble,
			container,
			preferredSide: "before",
			toolbar,
		});
		expect(atBubbleTop.placement).toBe("before");
		expect(atBubbleTop.top).toBe(0);

		const onFirstLine = resolveToolbarPosition({
			bubble,
			container,
			firstLine: { height: 24, top: 108 },
			preferredSide: "before",
			toolbar,
		});
		expect(onFirstLine.placement).toBe("before");
		expect(onFirstLine.left).toBe(266);
		expect(onFirstLine.top).toBe(6);
	});

	it("repositions the active toolbar when its message viewport scrolls", () => {
		let rowTop = 100;
		const view = render(
			<div data-slot="message-scroller-viewport">
				<div data-message-row-id="long-message">
					<div data-slot="bubble-content">Long message</div>
					<SpaceMessageFooter addressingTargets={[]} onCopy={vi.fn()} />
				</div>
			</div>
		);
		const viewport = view.container.querySelector<HTMLElement>(
			'[data-slot="message-scroller-viewport"]'
		);
		const row = view.container.querySelector<HTMLElement>(
			'[data-message-row-id="long-message"]'
		);
		const bubble = row?.querySelector<HTMLElement>(
			'[data-slot="bubble-content"]'
		);
		const toolbar = row?.querySelector<HTMLElement>(
			'[data-slot="message-footer"]'
		);
		expect(viewport && row && bubble && toolbar).toBeTruthy();
		if (!(viewport && row && bubble && toolbar)) {
			return;
		}
		viewport.getBoundingClientRect = () => rect(0, 0, 600, 600);
		row.getBoundingClientRect = () => rect(0, rowTop, 600, 1200);
		bubble.getBoundingClientRect = () => rect(100, rowTop, 300, 1200);
		toolbar.getBoundingClientRect = () => rect(0, 0, 180, 28);

		fireEvent.pointerEnter(row);
		expect(toolbar.style.insetBlockStart).toBe("0px");
		rowTop = -300;
		fireEvent.scroll(viewport);
		expect(toolbar.style.insetBlockStart).toBe("864px");
	});

	it.each([
		{ alignment: "left", previewLeft: 40, toolbarLeft: 150 },
		{ alignment: "right", previewLeft: 450, toolbarLeft: 284 },
	])("keeps attachment-only actions beside the visible preview on the $alignment", ({
		alignment,
		previewLeft,
		toolbarLeft,
	}) => {
		document.documentElement.dataset.spaceSelfMessageAlignment = alignment;
		const view = render(
			<div data-slot="message-scroller-viewport">
				<div
					data-message-row-id="attachment-message"
					data-space-self-message="true"
				>
					<div data-slot="bubble-content">
						<fieldset data-slot="space-attachment-strip">
							<div data-slot="scroll-area-viewport">
								<div className="space-attachment-strip-items">
									<div data-testid="attachment-preview" />
								</div>
							</div>
						</fieldset>
					</div>
					<SpaceMessageFooter addressingTargets={[]} />
				</div>
			</div>
		);
		const row = view.container.querySelector<HTMLElement>(
			'[data-message-row-id="attachment-message"]'
		);
		const bubble = row?.querySelector<HTMLElement>(
			'[data-slot="bubble-content"]'
		);
		const viewport = row?.querySelector<HTMLElement>(
			'[data-slot="scroll-area-viewport"]'
		);
		const preview = row?.querySelector<HTMLElement>(
			'[data-testid="attachment-preview"]'
		);
		const toolbar = row?.querySelector<HTMLElement>(
			'[data-slot="message-footer"]'
		);
		expect(row && bubble && viewport && preview && toolbar).toBeTruthy();
		if (!(row && bubble && viewport && preview && toolbar)) {
			return;
		}
		row.getBoundingClientRect = () => rect(0, 100, 600, 200);
		bubble.getBoundingClientRect = () => rect(0, 100, 560, 104);
		viewport.getBoundingClientRect = () => rect(0, 100, 560, 104);
		preview.getBoundingClientRect = () => rect(previewLeft, 100, 104, 104);
		toolbar.getBoundingClientRect = () => rect(0, 0, 160, 28);

		fireEvent.pointerEnter(row);
		expect(toolbar.style.insetInlineStart).toBe(`${toolbarLeft}px`);
	});
});

describe("SpaceMessageFooter", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps the normal action order and a compact overflow menu", () => {
		const view = render(
			<SpaceMessageFooter
				addressingTargets={[WAKE_TARGET]}
				details={{ hasProblem: false, onSelect: vi.fn() }}
				onCopy={vi.fn()}
				reply={{ label: "Reply", onSelect: vi.fn() }}
				thread={{ label: "Reply in thread", onSelect: vi.fn() }}
			/>
		);

		const primary = view.container.querySelector(
			'[data-slot="message-footer-primary-actions"]'
		);
		const footer = view.container.querySelector('[data-slot="message-footer"]');
		expect(footer?.className).toContain("absolute");
		expect(footer?.className).toContain("bg-popover");
		expect(primary).toBeTruthy();
		expect(
			within(primary as HTMLElement)
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label"))
		).toEqual(["Copy message", "Reply", "Reply in thread", "More actions"]);
		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(
			screen.getByRole("menuitem", { name: "Message details" })
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Message addressing" })
		).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "Copy message" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Reply" })).toBeNull();
		expect(
			screen.queryByRole("menuitem", { name: "Reply in thread" })
		).toBeNull();
	});

	it("keeps a failed footer compact and moves every secondary action into More", () => {
		const onOpenDetails = vi.fn();
		const view = render(
			<SpaceMessageFooter
				addressingTargets={[WAKE_TARGET]}
				details={{ hasProblem: true, onSelect: onOpenDetails }}
				failureSummary="Review Codex couldn’t reply"
				onCopy={vi.fn()}
				reply={{ label: "Reply", onSelect: vi.fn() }}
				thread={{ label: "Reply in thread", onSelect: vi.fn() }}
			/>
		);

		const footer = view.container.querySelector('[data-slot="message-footer"]');
		expect(footer?.getAttribute("data-persistent")).toBe("true");
		expect(footer?.className).not.toContain("before:");
		expect(footer?.className).not.toContain("after:");
		const failureAction = screen.getByRole("button", {
			name: "View error details: Review Codex couldn’t reply",
		});
		expect(failureAction.textContent).toBe("");
		expect(screen.queryByText("Review Codex couldn’t reply")).toBeNull();
		expect(screen.getByTestId("details-warning")).toBeTruthy();
		const primary = view.container.querySelector(
			'[data-slot="message-footer-primary-actions"]'
		) as HTMLElement;
		const primaryButtons = within(primary).getAllByRole("button");
		expect(
			primaryButtons.map((button) => button.getAttribute("aria-label"))
		).toEqual([
			"View error details: Review Codex couldn’t reply",
			"More actions",
		]);
		for (const button of primaryButtons) {
			expect(button.className).toContain("p-1.5");
			expect(button.className).toContain("max-lg:min-h-7");
			expect(button.className).toContain("max-lg:min-w-7");
			expect(button.className).not.toContain("max-lg:min-h-11");
			expect(button.className).not.toContain("max-lg:min-w-11");
		}
		expect(
			screen.getByRole("button", { name: "More actions" }).className
		).not.toContain("@min-[36rem]:hidden");
		fireEvent.click(failureAction);
		expect(onOpenDetails).toHaveBeenCalledOnce();

		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(screen.getByRole("menuitem", { name: "Copy message" })).toBeTruthy();
		expect(
			screen.queryByRole("menuitem", { name: "Message details" })
		).toBeNull();
		expect(screen.getByRole("menuitem", { name: "Reply" })).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Reply in thread" })
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Message addressing" })
		).toBeTruthy();
	});

	it("shows only the failure signal at rest and reveals the other actions on hover or focus", () => {
		const view = render(
			<SpaceMessageFooter
				addressingTargets={[]}
				details={{ hasProblem: true, onSelect: vi.fn() }}
				failureSummary="Review Codex couldn’t reply"
				onCopy={vi.fn()}
			/>
		);

		const footer = view.container.querySelector(
			'[data-slot="message-footer"]'
		) as HTMLElement;
		// Same toolbar chrome as a normal footer, visible at rest.
		expect(footer.className).toContain("bg-popover");
		expect(footer.className).toContain("border-border");
		expect(footer.className).toContain("opacity-100");
		expect(footer.className).not.toContain("bg-transparent");
		const problem = view.container.querySelector(
			'[data-slot="message-footer-problem"]'
		) as HTMLElement;
		expect(
			within(problem)
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label"))
		).toEqual(["View error details: Review Codex couldn’t reply"]);
		const reveal = view.container.querySelector(
			'[data-slot="message-footer-reveal-actions"]'
		) as HTMLElement;
		// The actions collapse to zero width at rest and stay focusable.
		const revealClasses = reveal.className.split(" ");
		expect(revealClasses).toContain("grid-cols-[0fr]");
		expect(revealClasses).not.toContain("hidden");
		expect(revealClasses).not.toContain("invisible");
		expect(revealClasses).toContain("group-hover/message-row:grid-cols-[1fr]");
		expect(revealClasses).toContain(
			"group-has-[:focus-visible]/message-row:grid-cols-[1fr]"
		);
		expect(revealClasses).toContain(
			"has-[[aria-haspopup][aria-expanded=true]]:grid-cols-[1fr]"
		);
		expect(revealClasses).toContain("motion-reduce:transition-none");
		expect(
			within(reveal).getByRole("button", { name: "More actions" })
		).toBeTruthy();
		// The failure icon comes first, so Tab moves from it into the actions
		// and the actions open away from it.
		expect(problem.nextElementSibling).toBe(reveal);
	});

	it.each([
		{
			// Left-aligned message: on the top border, in from the left edge.
			bubble: rect(100, 0, 300, 44),
			expectedStart: "112px",
			selfAligned: false,
		},
		{
			// Own right-aligned message: the same corner slot.
			bubble: rect(300, 0, 280, 44),
			expectedStart: "312px",
			selfAligned: true,
		},
		{
			// Own wide message: the same corner slot.
			bubble: rect(80, 0, 500, 44),
			expectedStart: "92px",
			selfAligned: true,
		},
		{
			// Own short message near the edge: shifted by its opened width, so
			// it stays inside the row when opened.
			bubble: rect(540, 0, 50, 44),
			expectedStart: "460px",
			selfAligned: true,
		},
	])("keeps a failed footer on the bubble's top border at rest and when opened ($expectedStart)", ({
		bubble: bubbleRect,
		expectedStart,
		selfAligned,
	}) => {
		if (selfAligned) {
			document.documentElement.dataset.spaceSelfMessageAlignment = "right";
		}
		const view = render(
			<div data-space-self-message={selfAligned ? "true" : undefined}>
				<div data-message-row-id="failed-message">
					<div data-slot="bubble-content">Failed message</div>
					<SpaceMessageFooter
						addressingTargets={[]}
						details={{ hasProblem: true, onSelect: vi.fn() }}
						failureSummary="Review Codex couldn’t reply"
						onCopy={vi.fn()}
					/>
				</div>
			</div>
		);
		const row = view.container.querySelector<HTMLElement>(
			"[data-message-row-id]"
		) as HTMLElement;
		const bubble = row.querySelector<HTMLElement>(
			'[data-slot="bubble-content"]'
		) as HTMLElement;
		const footer = row.querySelector<HTMLElement>(
			'[data-slot="message-footer"]'
		) as HTMLElement;
		const reveal = row.querySelector<HTMLElement>(
			'[data-slot="message-footer-reveal-actions"]'
		) as HTMLElement;
		const revealContent = reveal.querySelector<HTMLElement>(
			'[data-slot="message-footer-reveal-content"]'
		) as HTMLElement;
		revealContent.getBoundingClientRect = () => rect(0, 0, 110, 28);
		let revealWidth = 0;
		row.getBoundingClientRect = () => rect(0, 100, 600, 44);
		bubble.getBoundingClientRect = () =>
			rect(bubbleRect.left, 100, bubbleRect.width, 44);
		footer.getBoundingClientRect = () => rect(0, 0, 30 + revealWidth, 28);
		reveal.getBoundingClientRect = () => rect(0, 0, revealWidth, 28);

		fireEvent.pointerEnter(row);
		const rest = [footer.style.insetInlineStart, footer.style.insetBlockStart];
		expect(footer.dataset.placement).toBe("corner");
		// Centered on the bubble's top border.
		expect(rest).toEqual([expectedStart, "-14px"]);
		for (const width of [40, 110]) {
			revealWidth = width;
			fireEvent.pointerEnter(row);
			expect([
				footer.style.insetInlineStart,
				footer.style.insetBlockStart,
			]).toEqual(rest);
		}
	});

	it("holds a failed footer open while its Message details drawer is open", async () => {
		const onSelect = vi.fn();
		const view = render(
			<SpaceMessageFooter
				addressingTargets={[]}
				details={{ hasProblem: true, onSelect }}
				failureSummary="Review Codex couldn’t reply"
				onCopy={vi.fn()}
			/>
		);
		const reveal = view.container.querySelector(
			'[data-slot="message-footer-reveal-actions"]'
		) as HTMLElement;
		expect(reveal.className.split(" ")).toContain("grid-cols-[0fr]");

		fireEvent.click(
			screen.getByRole("button", {
				name: "View error details: Review Codex couldn’t reply",
			})
		);
		expect(onSelect).toHaveBeenCalledOnce();
		const drawer = document.createElement("div");
		drawer.setAttribute("role", "dialog");
		document.body.appendChild(drawer);
		await waitFor(() =>
			expect(
				view.container.querySelector('[data-message-details-active="true"]')
			).toBeTruthy()
		);
		expect(reveal.className.split(" ")).toContain("grid-cols-[1fr]");
		expect(reveal.className.split(" ")).not.toContain("grid-cols-[0fr]");

		drawer.remove();
		await waitFor(() =>
			expect(
				view.container.querySelector("[data-message-details-active]")
			).toBeNull()
		);
		expect(reveal.className.split(" ")).toContain("grid-cols-[0fr]");
	});

	it("keeps a normal footer free of the failed rest state", () => {
		const view = render(
			<SpaceMessageFooter addressingTargets={[]} onCopy={vi.fn()} />
		);

		const footer = view.container.querySelector(
			'[data-slot="message-footer"]'
		) as HTMLElement;
		expect(footer.className).toContain("bg-popover");
		expect(footer.className).not.toContain("bg-transparent");
		expect(
			view.container.querySelector('[data-slot="message-footer-problem"]')
		).toBeNull();
		expect(
			view.container.querySelector(
				'[data-slot="message-footer-reveal-actions"]'
			)
		).toBeNull();
	});

	it("keeps an accessible failure icon when Message details is unavailable", () => {
		const view = render(
			<SpaceMessageFooter
				addressingTargets={[]}
				failureSummary="Agent couldn’t reply"
				onCopy={vi.fn()}
			/>
		);

		expect(
			screen.getByRole("img", { name: "Agent couldn’t reply" })
		).toBeTruthy();
		expect(screen.queryByText("Agent couldn’t reply")).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: "View error details: Agent couldn’t reply",
			})
		).toBeNull();
		// The icon is not focusable, so the hidden actions must stay in the tab
		// order for keyboard users to reveal the toolbar.
		const reveal = view.container.querySelector(
			'[data-slot="message-footer-reveal-actions"]'
		) as HTMLElement;
		expect(reveal.className.split(" ")).not.toContain("hidden");
		expect(
			within(reveal).getByRole("button", { name: "More actions" })
		).toBeTruthy();
	});

	it("promotes Message details only when it reports a problem", () => {
		render(
			<SpaceMessageFooter
				addressingTargets={[]}
				details={{ hasProblem: true, onSelect: vi.fn() }}
				onCopy={vi.fn()}
			/>
		);
		expect(screen.getByTestId("details-warning")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Message details" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(
			screen.queryByRole("menuitem", { name: "Message details" })
		).toBeNull();
	});

	it("opens structured Wake addressing from the footer", () => {
		render(
			<SpaceMessageFooter
				addressingTargets={[WAKE_TARGET]}
				details={{ hasProblem: false, onSelect: vi.fn() }}
				onCopy={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Message addressing" })
		);
		expect(screen.getByText("Woke")).toBeTruthy();
		expect(screen.getByText("Review Codex")).toBeTruthy();
	});

	it("shows a check only after copying succeeds", async () => {
		const onCopy = vi
			.fn<() => Promise<boolean>>()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		render(<SpaceMessageFooter addressingTargets={[]} onCopy={onCopy} />);
		const copyButton = screen.getByRole("button", { name: "Copy message" });

		fireEvent.click(copyButton);
		await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
		expect(copyButton.getAttribute("aria-label")).toBe("Copy message");

		fireEvent.click(copyButton);
		await waitFor(() =>
			expect(copyButton.getAttribute("aria-label")).toBe("Copied")
		);
	});
});

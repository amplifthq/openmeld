import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render as renderComponent,
	screen,
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
		).toEqual([
			"Copy message",
			"Reply",
			"Reply in thread",
			"Message addressing",
			"Message details",
			"More actions",
		]);
		expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
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
		expect(screen.getByRole("menuitem", { name: "Reply" })).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Reply in thread" })
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Message addressing" })
		).toBeTruthy();
	});

	it("keeps an accessible failure icon when Message details is unavailable", () => {
		render(
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
	});

	it("opens structured Wake addressing from the footer", () => {
		render(
			<SpaceMessageFooter
				addressingTargets={[WAKE_TARGET]}
				details={{ hasProblem: false, onSelect: vi.fn() }}
				onCopy={vi.fn()}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Message addressing" }));

		const addressingPopover = screen
			.getByText("Message addressing")
			.closest('[data-slot="popover-content"]');
		expect(addressingPopover?.className).toContain("rounded-md");
		expect(screen.getByTestId("addressing-target")).toBeTruthy();
		expect(screen.getByText("Woke")).toBeTruthy();
		expect(screen.getByText("Review Codex")).toBeTruthy();
	});
});

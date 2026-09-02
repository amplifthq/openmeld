import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SpaceMessageFooter,
	type SpaceMessageFooterAddressingTarget,
} from "./space-message-footer";

vi.mock("@phosphor-icons/react", () => ({
	ArrowBendUpLeftIcon: () => <span />,
	CaretRightIcon: () => <span />,
	ChatCircleIcon: () => <span />,
	CopyIcon: () => <span />,
	DotsThreeIcon: () => <span />,
	InfoIcon: () => <span data-testid="details-info" />,
	TargetIcon: () => <span data-testid="addressing-target" />,
	WarningCircleIcon: () => <span data-testid="details-warning" />,
}));

const WAKE_TARGET: SpaceMessageFooterAddressingTarget = {
	agentControllerRef: "codex",
	avatarImageUrl: null,
	isCenterAgent: false,
	profileId: "agent-codex",
	profileKind: "agent",
	profileName: "Review Codex",
};

describe("SpaceMessageFooter", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps the normal action order and puts lower-priority actions in More", () => {
		const view = render(
			<SpaceMessageFooter
				addressingTargets={[WAKE_TARGET]}
				details={{ hasProblem: false, onSelect: vi.fn() }}
				onCopy={vi.fn()}
				reply={{ label: "Reply", onSelect: vi.fn() }}
				thread={{ label: "Reply in thread", onSelect: vi.fn() }}
				timestamp="11:45 PM"
			/>
		);

		const primary = view.container.querySelector(
			'[data-slot="message-footer-primary-actions"]'
		);
		const footer = view.container.querySelector('[data-slot="message-footer"]');
		expect(footer?.className).toContain("mt-0.5");
		expect(footer?.className).not.toContain("mt-1");
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
		expect(
			screen.getByRole("button", { name: "More actions" }).className
		).toContain("@min-[36rem]:hidden");

		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(screen.getByRole("menuitem", { name: "Reply" })).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Reply in thread" })
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Message addressing" })
		).toBeTruthy();
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
				timestamp="11:45 PM"
			/>
		);

		const footer = view.container.querySelector('[data-slot="message-footer"]');
		expect(footer?.getAttribute("data-persistent")).toBe("true");
		const failureAction = screen.getByRole("button", {
			name: "Open message details: Review Codex couldn’t reply",
		});
		expect(failureAction.className).toContain("hover:underline");
		expect(failureAction.className).toContain("focus-visible:underline");
		expect(screen.getByTestId("details-warning")).toBeTruthy();
		const primary = view.container.querySelector(
			'[data-slot="message-footer-primary-actions"]'
		) as HTMLElement;
		const primaryButtons = within(primary).getAllByRole("button");
		expect(
			primaryButtons.map((button) => button.getAttribute("aria-label"))
		).toEqual([
			"Message details",
			"Open message details: Review Codex couldn’t reply",
			"More actions",
		]);
		for (const button of [primaryButtons[0], primaryButtons[2]]) {
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

	it("keeps the failure summary readable when Message details is unavailable", () => {
		render(
			<SpaceMessageFooter
				addressingTargets={[]}
				failureSummary="Agent couldn’t reply"
				onCopy={vi.fn()}
				timestamp="11:45 PM"
			/>
		);

		expect(screen.getByText("Agent couldn’t reply").tagName).toBe("SPAN");
		expect(
			screen.queryByRole("button", {
				name: "Open message details: Agent couldn’t reply",
			})
		).toBeNull();
	});

	it("opens structured Wake addressing from the footer", () => {
		render(
			<SpaceMessageFooter
				addressingTargets={[WAKE_TARGET]}
				details={{ hasProblem: false, onSelect: vi.fn() }}
				onCopy={vi.fn()}
				timestamp="11:45 PM"
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

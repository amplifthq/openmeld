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
	AtIcon: () => <span />,
	CaretRightIcon: () => <span />,
	ChatCircleIcon: () => <span />,
	CopyIcon: () => <span />,
	DotsThreeIcon: () => <span />,
	InfoIcon: () => <span data-testid="details-info" />,
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
		expect(footer?.className).toContain("mt-1");
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

		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(screen.getByRole("menuitem", { name: "Reply" })).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Reply in thread" })
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Message addressing" })
		).toBeTruthy();
	});

	it("keeps a failed footer visible with Details first and calm failure copy", () => {
		const view = render(
			<SpaceMessageFooter
				addressingTargets={[]}
				details={{ hasProblem: true, onSelect: vi.fn() }}
				failureSummary="Review Codex couldn’t reply"
				onCopy={vi.fn()}
				timestamp="11:45 PM"
			/>
		);

		const footer = view.container.querySelector('[data-slot="message-footer"]');
		expect(footer?.getAttribute("data-persistent")).toBe("true");
		expect(screen.getByText("Review Codex couldn’t reply")).toBeTruthy();
		expect(screen.getByTestId("details-warning")).toBeTruthy();
		expect(
			within(
				view.container.querySelector(
					'[data-slot="message-footer-primary-actions"]'
				) as HTMLElement
			)
				.getAllByRole("button")
				.at(0)
				?.getAttribute("aria-label")
		).toBe("Message details");
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

		expect(screen.getByText("Message addressing")).toBeTruthy();
		expect(screen.getByText("Woke")).toBeTruthy();
		expect(screen.getByText("Review Codex")).toBeTruthy();
	});
});

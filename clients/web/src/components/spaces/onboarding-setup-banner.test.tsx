import { buildOnboardingPlan } from "@openmeld/start";
import {
	fullySetUpOnboardingFacts,
	joinedWithAddableAgentOnboardingFacts,
	joinedZeroAgentsOnboardingFacts,
} from "@openmeld/start/testing";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	OnboardingSetupBanner,
	type OnboardingSetupBannerProps,
	OnboardingSetupEmptyStateActions,
} from "./onboarding-setup-banner";

afterEach(cleanup);

const ADD_AGENTS_BUTTON_NAME_PATTERN = /^Add agents/;
const CONNECT_THIS_COMPUTER_BUTTON_NAME_PATTERN = /^Connect this computer/;

function renderBanner(
	plan: OnboardingSetupBannerProps["plan"],
	overrides: Partial<OnboardingSetupBannerProps> = {}
) {
	const props: OnboardingSetupBannerProps = {
		plan,
		onConnect: vi.fn(),
		onAddAgents: vi.fn(),
		orgSlug: "acme",
		spaceId: "space-1",
		spaceName: "Test Space",
		dismissedIds: new Set(),
		onDismiss: vi.fn(),
		...overrides,
	};
	const result = render(<OnboardingSetupBanner {...props} />);
	return { props, ...result };
}

function renderEmptyStateActions(
	plan: OnboardingSetupBannerProps["plan"],
	overrides: Partial<OnboardingSetupBannerProps> = {}
) {
	const props: OnboardingSetupBannerProps = {
		plan,
		onConnect: vi.fn(),
		onAddAgents: vi.fn(),
		orgSlug: "acme",
		spaceId: "space-1",
		spaceName: "Test Space",
		dismissedIds: new Set(),
		onDismiss: vi.fn(),
		...overrides,
	};
	const result = render(
		<OnboardingSetupEmptyStateActions
			onAddAgents={props.onAddAgents}
			onConnect={props.onConnect}
			plan={props.plan}
		/>
	);
	return { props, ...result };
}

// Joined, owns an agent that is not a member, this computer not connected:
// both connect + bring-agents are available.
function hasAgentNotConnectedFacts() {
	return {
		...joinedWithAddableAgentOnboardingFacts(),
		device: { status: "not_connected" as const },
	};
}

describe("OnboardingSetupBanner", () => {
	it("uses the shared progressive blur without solid banner or row surfaces", () => {
		renderBanner(buildOnboardingPlan(hasAgentNotConnectedFacts()));

		const banner = screen.getByRole("region", { name: "Get set up" });
		const blur = banner.querySelector('[data-slot="progressive-blur"]');
		const connectRow = screen
			.getByText("Connect this computer")
			.closest('[data-slot="onboarding-setup-action"]');

		expect(blur).not.toBeNull();
		expect((blur as HTMLElement).style.backdropFilter).toBe("blur(6px)");
		expect(banner.className.split(" ")).not.toContain("border-b");
		expect(banner.className.split(" ")).not.toContain("bg-muted/10");
		expect(connectRow).not.toBeNull();
		expect(connectRow?.className.split(" ")).not.toContain("border");
		expect(connectRow?.className.split(" ")).not.toContain("bg-card");
		expect(screen.getByText("Optional. Dismiss anytime.")).toBeTruthy();
	});

	it("keeps full-strength blur behind every setup row and fades only below the content", () => {
		renderBanner(buildOnboardingPlan(hasAgentNotConnectedFacts()));

		const banner = screen.getByRole("region", { name: "Get set up" });
		const blur = banner.querySelector<HTMLElement>(
			'[data-slot="progressive-blur"]'
		);

		expect(blur).not.toBeNull();
		expect(blur?.style.height).toBe("calc(100% + 2rem)");
		expect(blur?.style.backgroundImage).toBe(
			"linear-gradient(to top, transparent, var(--background))"
		);
		expect(blur?.style.maskImage).toBe(
			"linear-gradient(to bottom, black 0, black calc(100% - 2rem), transparent 100%)"
		);
	});

	it("shows connect AND add-your-first-agent guidance when the account has no agent yet", () => {
		renderBanner(buildOnboardingPlan(joinedZeroAgentsOnboardingFacts()));

		expect(screen.getByText("Connect this computer")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Connect OpenMeld Service" })
		).toBeTruthy();
		// First-run guidance: no agent yet surfaces the create-first-agent row, not
		// silence. It is the "create" action, not the "add an existing agent" row.
		expect(screen.getByText("Add your first agent")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create Agent" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Add agents" })).toBeNull();
	});

	it("shows only the add-your-first-agent guidance when connected with no agent", () => {
		// The regression Felix hit: once the computer is connected the connect row
		// is done, but an account with no agent must still get a next step instead
		// of a blank Space.
		renderBanner(
			buildOnboardingPlan({
				...joinedZeroAgentsOnboardingFacts(),
				device: { status: "connected" },
			})
		);

		expect(screen.queryByText("Connect this computer")).toBeNull();
		expect(screen.getByText("Add your first agent")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create Agent" })).toBeTruthy();
	});

	it("dismisses the create-first-agent row through its handler", () => {
		// The "Create Agent" CTA opens a dialog that needs a
		// QueryClientProvider to mount, so it is exercised where that provider
		// exists; here we only assert the per-row dismiss wiring.
		const { props } = renderBanner(
			buildOnboardingPlan(joinedZeroAgentsOnboardingFacts())
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Dismiss add your first agent" })
		);
		expect(props.onDismiss).toHaveBeenCalledWith("bring_agents");
	});

	it("shows connect and add-agents when the user has an agent but this computer is offline", () => {
		renderBanner(buildOnboardingPlan(hasAgentNotConnectedFacts()));

		expect(screen.getByText("Connect this computer")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add agents" })).toBeTruthy();
	});

	it("shows only add-agents once this computer is connected", () => {
		renderBanner(buildOnboardingPlan(joinedWithAddableAgentOnboardingFacts()));

		expect(screen.queryByText("Connect this computer")).toBeNull();
		expect(screen.getByRole("button", { name: "Add agents" })).toBeTruthy();
	});

	it("renders nothing (clean conversation) when nothing is actionable", () => {
		const { container } = renderBanner(
			buildOnboardingPlan(fullySetUpOnboardingFacts())
		);

		expect(container.firstChild).toBeNull();
	});

	it("no longer offers a Manage in Agents link", () => {
		renderBanner(buildOnboardingPlan(hasAgentNotConnectedFacts()));

		expect(
			screen.queryByRole("button", { name: "Manage in Agents" })
		).toBeNull();
	});

	it("routes connect to the centralized setup page instead of an inline command", () => {
		const { props } = renderBanner(
			buildOnboardingPlan(hasAgentNotConnectedFacts())
		);

		// The raw command is no longer dumped into the conversation banner.
		expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: "Connect OpenMeld Service" })
		);
		expect(props.onConnect).toHaveBeenCalledTimes(1);
	});

	it("routes add-agents and per-row dismiss to their handlers", () => {
		const { props } = renderBanner(
			buildOnboardingPlan(hasAgentNotConnectedFacts())
		);

		fireEvent.click(screen.getByRole("button", { name: "Add agents" }));
		expect(props.onAddAgents).toHaveBeenCalledTimes(1);

		fireEvent.click(
			screen.getByRole("button", { name: "Dismiss bring your agents" })
		);
		expect(props.onDismiss).toHaveBeenCalledWith("bring_agents");

		fireEvent.click(
			screen.getByRole("button", { name: "Dismiss connect this computer" })
		);
		expect(props.onDismiss).toHaveBeenCalledWith("connect_this_computer");
	});

	it("hides a dismissed row but keeps the others", () => {
		renderBanner(buildOnboardingPlan(hasAgentNotConnectedFacts()), {
			dismissedIds: new Set(["bring_agents"] as const),
		});

		expect(screen.queryByRole("button", { name: "Add agents" })).toBeNull();
		expect(screen.getByText("Connect this computer")).toBeTruthy();
	});

	it("renders nothing once every available row is dismissed", () => {
		const { container } = renderBanner(
			buildOnboardingPlan(hasAgentNotConnectedFacts()),
			{
				dismissedIds: new Set([
					"bring_agents",
					"connect_this_computer",
				] as const),
			}
		);

		expect(container.firstChild).toBeNull();
	});
});

describe("OnboardingSetupEmptyStateActions", () => {
	it("shows connect and add agents together using the shared Fluid Card group", () => {
		const { props } = renderEmptyStateActions(
			buildOnboardingPlan(hasAgentNotConnectedFacts())
		);

		expect(
			screen.getByRole("group", { name: "Set up this Space" })
		).toBeTruthy();
		expect(document.querySelectorAll("[data-fluid-card-group]")).toHaveLength(
			1
		);
		expect(document.querySelectorAll("[data-fluid-card-item]")).toHaveLength(2);
		expect(
			screen.getByText(
				"Bring Codex, Claude Code, or another local agent into OpenMeld. Then add it to this Space."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Choose an available agent—or create one—and add it to this Space."
			)
		).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", {
				name: CONNECT_THIS_COMPUTER_BUTTON_NAME_PATTERN,
			})
		);
		fireEvent.click(
			screen.getByRole("button", { name: ADD_AGENTS_BUTTON_NAME_PATTERN })
		);
		expect(props.onConnect).toHaveBeenCalledTimes(1);
		expect(props.onAddAgents).toHaveBeenCalledTimes(1);
	});

	it("keeps Add agents actionable when the user still needs to create an agent", () => {
		const { props } = renderEmptyStateActions(
			buildOnboardingPlan(joinedZeroAgentsOnboardingFacts())
		);

		expect(
			screen.getByRole("button", {
				name: CONNECT_THIS_COMPUTER_BUTTON_NAME_PATTERN,
			})
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: ADD_AGENTS_BUTTON_NAME_PATTERN })
		);
		expect(props.onAddAgents).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("button", { name: "Create Agent" })).toBeNull();
	});

	it("renders nothing when setup is complete", () => {
		const { container } = renderEmptyStateActions(
			buildOnboardingPlan(fullySetUpOnboardingFacts())
		);

		expect(container.firstChild).toBeNull();
	});
});

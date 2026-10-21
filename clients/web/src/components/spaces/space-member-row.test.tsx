import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type { ModelCatalog } from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDirectoryHumanProfileActivityLabel } from "#/components/directory/directory-human-profile-format";
import { SpaceMemberRow } from "./space-member-row";
import type { SpaceWakeStatusTransientState } from "./space-wake-status-refresh";

const MODEL_DEFAULT_PATTERN = /model default/;
const CONTROLLER_DEFAULT_PATTERN = /Controller default/;

const { toastMock } = vi.hoisted(() => ({
	toastMock: {
		success: vi.fn(),
	},
}));

vi.mock("sonner", () => ({
	toast: toastMock,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(async () => undefined),
	useLocation: ({
		select,
	}: {
		select: (location: { pathname: string }) => string;
	}) => select({ pathname: "/o/acme/spaces/space-1" }),
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("SpaceMemberRow", () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllEnvs();
		toastMock.success.mockReset();
	});

	it("does not describe a live agent as connected for Wake unless it is wakeable", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				liveNow: true,
				presenceStatus: "live",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.getAttribute("aria-label")).toBe("Live");
		expect(indicator.getAttribute("aria-description")).toBe("Live agent");
		expect(screen.queryByText("Live")).toBeNull();
		expect(screen.queryByText("Available for Wake")).toBeNull();
		expect(screen.queryByText("Connected to Office Mac")).toBeNull();
		expect(screen.getByText("Local setup preference: Office Mac")).toBeTruthy();
	});

	it("shows Wake availability as a status dot beside the agent name", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				liveNow: false,
				presenceStatus: "wakeable",
			}),
		});

		const indicator = screen.getByTestId("space-agent-availability-indicator");
		const indicatorDot = indicator.querySelector(
			'[data-slot="space-agent-availability-indicator-dot"]'
		);
		const agentName = getProfileNameElement("Codex");

		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Available");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Available for Wake"
		);
		expect(indicatorDot?.className).toContain("bg-emerald-");
		expect(
			agentName.closest("button")?.parentElement?.contains(indicator)
		).toBe(true);
		expect(screen.queryByText("Available")).toBeNull();
		expect(screen.getByText("Connected to Office Mac")).toBeTruthy();
		expect(screen.queryByText("Codex · gpt-5.3-codex-spark · high")).toBeNull();
	});

	it("renders unavailable sign-in guidance with the existing warning tone", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				availabilityAction: "none",
				availabilityBadgeLabel: "Sign-in needed",
				availabilityCategory: "unavailable",
				availabilityPhase: "provider_sign_in_needed",
				availabilityReasonCode: "controller.auth.unauthenticated",
				availabilitySummary:
					"Run codex login in a terminal on this computer to sign in to Codex.",
				availabilityTooltip:
					"Codex is not signed in. Run codex login in a terminal on this computer.",
				presenceStatus: "unavailable",
			}),
		});

		const indicator = screen.getByTestId("space-agent-availability-indicator");
		const indicatorDot = indicator.querySelector(
			'[data-slot="space-agent-availability-indicator-dot"]'
		);
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Sign-in needed");
		expect(indicatorDot?.className).toContain("bg-amber-");
		expect(indicatorDot?.className).not.toContain("bg-emerald-");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Codex is not signed in. Run codex login in a terminal on this computer."
		);
		expect(screen.queryByText("Sign-in needed")).toBeNull();
		expect(getProfileNameElement("Codex").className).toContain(
			"text-muted-foreground"
		);
		expect(screen.queryByText("Connected to Office Mac")).toBeNull();
	});

	it("marks cross-workspace Agent Profiles without offering a repair action", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildPreparePlan(),
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Wrong workspace",
				availabilityCategory: "unavailable",
				availabilitySummary:
					"This Agent Profile belongs to a different workspace.",
				availabilityReasonCode: "agent_profile.organization_mismatch",
				availabilityTooltip: "This Agent Profile belongs to another workspace",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Wrong workspace");
		expect(indicator.getAttribute("aria-description")).toBe(
			"This Agent Profile belongs to another workspace"
		);
		expect(getAgentAvailabilityIndicatorDot().className).toContain("bg-amber-");
		expect(getProfileNameElement("Codex").className).toContain(
			"text-muted-foreground"
		);
		expect(indicator.getAttribute("href")).toBeNull();
		expect(indicator.getAttribute("data-availability-reason-code")).toBe(
			"agent_profile.organization_mismatch"
		);
		expect(
			screen.getByText("This Agent Profile belongs to a different workspace.")
		).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: "Connect local agent" })
		).toBeNull();
		expect(screen.queryByText("Needs setup on this computer")).toBeNull();
	});

	it.each([
		"agent_profile.organization_context_missing",
		"agent_profile.organization_lookup_failed",
		"agent_profile.space_organization_unavailable",
		"organization_binding_authorization.lookup_failed",
		"organization_binding_authorization.preference_unavailable",
		"organization_binding_authorization.required",
		"organization_binding_authorization.space_org_unavailable",
	])("does not offer local recovery for workspace blocker %s", (reasonCode) => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildPreparePlan(),
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Workspace unavailable",
				availabilityCategory: "unavailable",
				availabilityReasonCode: reasonCode,
				availabilitySummary:
					"OpenMeld could not verify this Agent Profile's workspace.",
				availabilityTooltip:
					"OpenMeld could not verify this Agent Profile's workspace",
			}),
		});

		expect(
			screen.queryByRole("link", { name: "Connect local agent" })
		).toBeNull();
		expect(screen.queryByText("Needs setup on this computer")).toBeNull();
	});

	it("opens profile details from an agent member name", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				agentControllerConversationId: "thread-codex-1",
				availabilityReasonCode: "agent_execution.ready",
				availabilitySummary: "Codex can reply from this computer.",
				availabilityTooltip: "Available for Wake",
				workingDirectory: "/Users/felix/project",
			}),
			modelCatalog: buildModelCatalog(),
		});

		const profileSummaryButton = screen.getByRole("button", {
			name: "Check Codex Profile",
		});
		fireEvent.click(profileSummaryButton);

		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(
			screen
				.getByTestId("profile-details-popover-scroll-area")
				.querySelector('[data-slot="scroll-area-viewport"]')
				?.getAttribute("data-orientation")
		).toBe("vertical");
		expect(screen.queryByText("Controller conversation ID")).toBeNull();
		expect(screen.queryByText("thread-codex-1")).toBeNull();
		const detailsLink = screen.getByRole("link", {
			name: "Edit Codex",
		});
		expect(detailsLink.getAttribute("href")).toBe(
			"/o/acme/agents?profileId=agt-1"
		);
		expect(
			screen.queryByRole("button", { name: "More options for Codex" })
		).toBeNull();
		expect(screen.queryByText("Workspace directory")).toBeNull();
		expect(screen.queryByText("/Users/felix/project")).toBeNull();
		expect(
			screen.getAllByText("Codex · gpt-5.3-codex-spark · high").length
		).toBeGreaterThan(0);
		expect(screen.queryByText("agent_execution.ready")).toBeNull();
	});

	it("matches the sidebar type scale for both Agent and Human names", () => {
		const view = renderSpaceMemberRow({ entry: buildAgentEntry() });
		const agentName = getProfileNameElement("Codex");
		expect(agentName.className).toContain("font-medium");
		expect(agentName.className).toContain("text-[13px]");
		expect(agentName.className).toContain("sm:text-[13px]");
		expect(agentName.className).not.toContain("font-bold");

		view.unmount();
		renderSpaceMemberRow({ entry: buildHumanEntry() });
		const humanName = getProfileNameElement("Felix");
		expect(humanName.className).toContain("font-medium");
		expect(humanName.className).toContain("text-[13px]");
		expect(humanName.className).toContain("sm:text-[13px]");
		expect(humanName.className).not.toContain("font-bold");
	});

	it("confirms removing a member from the row actions menu", async () => {
		const onRemoveFromSpace = vi.fn(async () => ({
			alreadyAbsentCount: 0,
			removedCount: 1,
		}));

		renderSpaceMemberRow({
			entry: buildHumanEntry({
				id: "human-2",
				ownerDisplay: "Mira",
				ownerName: "Mira",
				ownerUserId: "user-2",
				profileId: "human-2",
				profileName: "Mira",
				searchText: "mira",
			}),
			onRemoveFromSpace,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Member options for Mira" })
		);
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Remove from Space" })
		);

		const dialog = within(screen.getByRole("dialog"));
		expect(dialog.getByText("Remove Mira from this Space?")).toBeTruthy();
		expect(
			dialog.getByText(
				"This removes the Profile from this Space. It does not delete the Profile."
			)
		).toBeTruthy();

		fireEvent.click(dialog.getByRole("button", { name: "Remove from Space" }));

		await waitFor(() => {
			expect(onRemoveFromSpace).toHaveBeenCalledWith("human-2");
		});
		expect(toastMock.success).toHaveBeenCalledWith(
			"Mira was removed from this Space."
		);
	});

	it("opens the canonical Agent editor from the profile popover", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				ownerUserId: "user-1",
				profileId: "agt-owned",
				profileName: "Research Agent",
			}),
			onRemoveFromSpace: undefined,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Check Research Agent Profile" })
		);
		expect(screen.queryByRole("menu")).toBeNull();
		expect(
			screen
				.getByRole("link", { name: "Edit Research Agent" })
				.getAttribute("href")
		).toBe("/o/acme/agents?profileId=agt-owned");
	});

	it("keeps profile details available without offering a separate edit action", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				ownerUserId: "user-2",
				profileName: "Mira's Agent",
			}),
			onRemoveFromSpace: undefined,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Check Mira's Agent Profile" })
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: "Edit Mira's Agent" })
		).toBeNull();
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("keeps compact Agent details in the profile popover instead of the member row", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildServiceConnectionPlan(),
			entry: buildAgentEntry({
				addedByDisplayName: "Felix",
				availabilityBadgeLabel: "Offline",
				availabilityCategory: "offline",
				availabilityPhase: "offline",
				availabilityReasonCode: "local_service.not_connected_for_account",
				availabilitySummary:
					"Connect your computer before this Agent can reply.",
				availabilityTooltip: "Computer not connected",
				lastSeenLabel: "Seen 16d ago",
				presenceStatus: "offline",
			}),
			modelCatalog: buildModelCatalog(),
		});

		expect(
			screen.getByText("Connect your computer before this Agent can reply.")
		).toBeTruthy();
		expect(screen.queryByText("Codex · gpt-5.3-codex-spark · high")).toBeNull();
		expect(
			screen.queryByText(
				"OpenMeld Service is not connected · Added by Felix · Seen 16d ago"
			)
		).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: "Check Codex Profile" })
		);
		const dialog = within(screen.getByRole("dialog"));
		expect(dialog.getByText("Codex · gpt-5.3-codex-spark · high")).toBeTruthy();
		expect(dialog.queryByText("Last activity in this Space")).toBeNull();
		expect(
			dialog.getByText("Connect your computer before this Agent can reply.")
		).toBeTruthy();
	});

	it("hides local connection details when the viewer does not own the agent profile", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				agentControllerConversationId: null,
				availabilityReasonCode: "agent_execution.ready",
				availabilitySummary: "Codex can reply from this computer.",
				availabilityTooltip: "Available for Wake",
				modelSelection: null,
				ownerDisplay: "Mira",
				ownerUserId: "user-2",
				runtimeDeviceDisplayName: null,
				workingDirectory: null,
			}),
			modelCatalog: buildModelCatalog(),
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Check Codex Profile" })
		);

		const dialog = within(screen.getByRole("dialog"));
		const availableForWake = dialog.getByText("Available for Wake");
		expect(availableForWake).toBeTruthy();
		expect(availableForWake.className).toContain("text-emerald-");
		expect(dialog.queryByText("How this Agent works")).toBeNull();
		expect(dialog.queryByText("Connection")).toBeNull();
		expect(dialog.queryByText("Controller conversation ID")).toBeNull();
		expect(dialog.queryByText("thread-codex-1")).toBeNull();
		expect(dialog.queryByText("Workspace directory")).toBeNull();
		expect(dialog.queryByText("/Users/mira/project")).toBeNull();
		expect(dialog.queryByText("Wake reason code")).toBeNull();
	});

	it("shows model default when a member has a selected model without reasoning effort", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				modelSelection: {
					modelId: "gpt-5.4",
				},
				presenceStatus: "wakeable",
			}),
			modelCatalog: buildModelCatalog(),
		});

		expect(screen.queryByText("Codex · GPT-5.4 · model default")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Check Codex Profile" })
		);
		expect(
			within(screen.getByRole("dialog")).getByText(
				"Codex · GPT-5.4 · model default"
			)
		).toBeTruthy();
	});

	it("does not infer an existing conversation's model from the catalog default", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				modelSelection: null,
				presenceStatus: "wakeable",
			}),
			modelCatalog: buildModelCatalog(),
		});

		expect(screen.queryByText("Codex · GPT-5.5 · model default")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Check Codex Profile" })
		);
		// With no saved model only the controller shows, never the catalog default.
		const dialog = within(screen.getByRole("dialog"));
		expect(dialog.queryByText(MODEL_DEFAULT_PATTERN)).toBeNull();
		expect(dialog.queryByText(CONTROLLER_DEFAULT_PATTERN)).toBeNull();
	});

	it("exposes AgentWakeAvailability fields on the Wake indicator", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				availabilityAction: "none",
				availabilityBadgeLabel: "Available",
				availabilityCategory: "available",
				availabilityPhase: "available",
				availabilityReasonCode: "agent_execution.ready",
				availabilityTooltip: "Available for Wake",
				liveNow: false,
				presenceStatus: "wakeable",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Available");
		expect(indicator.getAttribute("data-availability-action")).toBe("none");
		expect(indicator.getAttribute("data-availability-category")).toBe(
			"available"
		);
		expect(indicator.getAttribute("data-availability-phase")).toBe("available");
		expect(indicator.getAttribute("data-availability-reason-code")).toBe(
			"agent_execution.ready"
		);
	});

	it("links the service update indicator to the focused OpenMeld Service card", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				availabilityAction: "update_service",
				availabilityBadgeLabel: "Update",
				availabilityCategory: "unavailable",
				availabilityPhase: "service_update_required",
				availabilityReasonCode: "service.update_required",
				availabilitySummary:
					"Update OpenMeld Service before this agent can reply.",
				availabilityTooltip: "Update OpenMeld Service",
				presenceLabel: "update OpenMeld Service",
				presenceStatus: "unavailable",
			}),
		});

		const indicatorLink = screen.getByRole("link", { name: "Update" });
		expect(indicatorLink.getAttribute("href")).toBe(
			"/o/acme/computers?focus=service"
		);
		expect(
			screen.getByText("Update OpenMeld Service before this agent can reply.")
		).toBeTruthy();
	});

	it("shows the service update indicator as passive status for non-owners", () => {
		renderSpaceMemberRow({
			currentOwnerUserId: "user-1",
			entry: buildAgentEntry({
				availabilityAction: "update_service",
				availabilityBadgeLabel: "Update",
				availabilityCategory: "unavailable",
				availabilityPhase: "service_update_required",
				availabilityReasonCode: "service.update_required",
				availabilitySummary:
					"Update OpenMeld Service before this agent can reply.",
				availabilityTooltip: "Update OpenMeld Service",
				ownerDisplay: "Mira",
				ownerUserId: "user-2",
				presenceLabel: "update OpenMeld Service",
				presenceStatus: "unavailable",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Update");
		expect(indicator.getAttribute("data-availability-action")).toBe(
			"update_service"
		);
		expect(indicator.getAttribute("aria-description")).toBe(
			"Update OpenMeld Service"
		);
		expect(screen.queryByRole("link", { name: "Update" })).toBeNull();
		expect(
			screen.getByText("Controlled by Office Mac Codex · Owned by Mira")
		).toBeTruthy();
	});

	it("lets the owner check an expired Wake route again from the member row", async () => {
		const onCheckAgentWakeAvailability = vi.fn(async () => undefined);
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Offline",
				availabilityCategory: "offline",
				availabilityPhase: "offline",
				availabilityReasonCode: "wake_route.registration_expired",
				availabilitySummary: "This agent's connection is offline.",
				availabilityTooltip: "Wake route expired",
				presenceStatus: "offline",
			}),
			onCheckAgentWakeAvailability,
		});

		expect(
			screen.getByText("This agent's connection is offline.")
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Check again" }));

		await waitFor(() => {
			expect(onCheckAgentWakeAvailability).toHaveBeenCalledWith("agt-1");
		});
	});

	it("shows expired Wake routes as Checking while refresh is in progress", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Offline",
				availabilityCategory: "offline",
				availabilityPhase: "offline",
				availabilityReasonCode: "wake_route.registration_expired",
				availabilitySummary: "This agent's connection is offline.",
				availabilityTooltip: "Wake route expired",
				presenceStatus: "offline",
			}),
			memberTransientState: "checking",
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Checking");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Checking Wake availability"
		);
		expect(
			screen.getByText("OpenMeld is checking this agent's local connection.")
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
	});

	it("does not let transient Checking hide a resolved unavailable status", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Unavailable",
				availabilityCategory: "unavailable",
				availabilityPhase: "unavailable",
				availabilityReasonCode: "agent_profile_binding.missing",
				availabilitySummary:
					"Connect a local agent before this agent can reply.",
				availabilityTooltip: "Connect local agent",
				presenceStatus: "unavailable",
			}),
			memberTransientState: "checking",
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Unavailable");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Connect local agent"
		);
		expect(
			screen.getByText("Connect a local agent before this agent can reply.")
		).toBeTruthy();
	});

	it("uses AgentWakeAvailability summary before owner-owner wake diagnostics copy", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildConflictPlan(),
			entry: buildAgentEntry({
				availabilityAction: "check_status",
				availabilityBadgeLabel: "Unavailable",
				availabilityPhase: "unavailable",
				availabilityReasonCode:
					"agent_profile_binding.controller_conversation_conflict",
				availabilitySummary:
					"This agent shares a reply conversation with another Agent Profile.",
				availabilityTooltip: "Duplicate reply conversation",
				presenceStatus: "unavailable",
			}),
		});

		expect(
			screen.getByText(
				"This agent shares a reply conversation with another Agent Profile."
			)
		).toBeTruthy();
		expect(screen.queryByText("Local setup preference: Office Mac")).toBeNull();
		const indicator = screen.getByTestId("space-agent-availability-indicator");
		expect(indicator.getAttribute("data-availability-reason-code")).toBe(
			"agent_profile_binding.controller_conversation_conflict"
		);
		expect(indicator.getAttribute("aria-description")).toBe(
			"Duplicate reply conversation"
		);
		expect(screen.queryByText("Connect local agent")).toBeNull();
		expect(screen.queryByText("Review agent settings")).toBeNull();
	});

	it("uses the selected local agent logo before an agent profile name", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				agentControllerRef: "builtin:codex",
			}),
		});

		expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
	});

	it("uses a Bot avatar for the Center Agent in an ordinary Space", () => {
		renderSpaceMemberRow({
			centerAgentProfileId: "agt-1",
			entry: buildAgentEntry({
				agentControllerRef: "builtin:codex",
				avatarStyle: "clover",
			}),
		});

		const avatar = screen.getByTestId("space-profile-icon-agt-1");
		expect(avatar.querySelector("canvas[data-bot-avatar]")).toBeTruthy();
		expect(screen.queryByTestId("local-agent-logo-codex")).toBeNull();
	});

	it("treats the Center Agent as the canonical Center Agent chat, not an editable Agent Profile", () => {
		renderSpaceMemberRow({
			centerAgentProfileId: "agt-1",
			entry: buildAgentEntry({
				agentControllerRef: "hosted:center-agent",
				availabilityCategory: "available",
				availabilityBadgeLabel: "Available",
				availabilitySummary: "This Agent can answer now.",
				modelSelection: { modelId: "anthropic/claude-opus-5.5" },
				profileName: "Amplift Center Agent",
			}),
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: "Check Amplift Center Agent Profile",
			})
		);

		const dialog = within(screen.getByRole("dialog"));
		expect(
			dialog
				.getByRole("link", { name: "Chat with Amplift Center Agent" })
				.getAttribute("href")
		).toBe("/o/acme/chats/center-agent");
		expect(
			dialog.queryByRole("link", { name: "Edit Amplift Center Agent" })
		).toBeNull();
		expect(dialog.queryByText("Check more or edit")).toBeNull();
		expect(
			dialog.getByRole("button", { name: "Open Center Agent settings" })
		).toBeTruthy();
		expect(dialog.getByRole("img", { name: "Remote Agent" })).toBeTruthy();
		expect(dialog.queryByText("Available")).toBeNull();
		expect(dialog.queryByText("This Agent can answer now.")).toBeNull();
		expect(dialog.getByText("anthropic/claude-opus-5.5")).toBeTruthy();
		expect(dialog.queryByText("model default", { exact: false })).toBeNull();
	});

	it("uses the generic agent icon without a bound controller", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				agentControllerRef: null,
			}),
		});

		const avatar = screen.getByTestId("space-profile-icon-agt-1");
		expect(
			screen.getByTestId("space-agent-profile-fallback-icon-agt-1")
		).toBeTruthy();
		expect(avatar.querySelector("canvas")).toBeNull();
		expect(screen.queryByTestId("local-agent-logo-codex")).toBeNull();
	});

	it("uses human initials before a human profile name", () => {
		renderSpaceMemberRow({
			density: "compact",
			entry: buildHumanEntry(),
		});

		const avatar = screen.getByTestId("space-profile-icon-human-1");
		expect(avatar.className).toContain("size-5");
		expect(avatar.textContent).toBe("F");
		expect(
			avatar.querySelector("canvas")?.getAttribute("data-profile-avatar-seed")
		).toBe("openmeld-dither-profile-avatar:v1:human:human-1");
		const selfStatus = screen.getByTestId("space-member-self-status");
		expect(selfStatus.textContent).toBe("You");
		expect(selfStatus.className).toContain("before:content-['·']");
		expect(selfStatus.className).toContain("text-muted-foreground");
		expect(selfStatus.className).not.toContain("border");
		expect(selfStatus.className).not.toContain("bg-");
		const liveStatus = screen.getByTestId("space-member-presence-status");
		expect(liveStatus.textContent).toBe("Live");
		expect(liveStatus.getAttribute("aria-description")).toBe("Live person");
		expect(liveStatus.className).toContain("before:content-['·']");
		expect(liveStatus.className).toContain("text-emerald-");
		expect(liveStatus.className).not.toContain("border");
		expect(liveStatus.className).not.toContain("bg-");
		expect(screen.queryByText("You are live in this space.")).toBeNull();
		expect(screen.queryByText("You are in this space.")).toBeNull();
	});

	it("keeps meaningful Space activity inline for a person", () => {
		const organizationActivity = resolveDirectoryHumanProfileActivityLabel({
			lastActiveAt: "2026-08-31T13:20:00.000Z",
			nowMs: Date.parse("2026-08-31T14:00:00.000Z"),
			profileStatus: "active",
		});

		renderSpaceMemberRow({
			currentProfileId: "human-current",
			density: "compact",
			entry: buildHumanEntry({
				lastSeenLabel: "Seen 8h ago",
				liveNow: false,
				presenceLabel: "Seen 8h ago",
				lastSeenAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
				presenceStatus: null,
			}),
		});

		expect(organizationActivity).toBe("40 minutes ago");
		expect(screen.getByText("Here 8h ago")).toBeTruthy();
		const spaceActivity = screen.getByLabelText("Here 8h ago");
		expect(spaceActivity.getAttribute("aria-description")).toBe(
			"Last activity in this Space"
		);
		expect(screen.queryByText("Seen 8h ago")).toBeNull();
	});

	it("shows concise Space-specific recency in the Human profile popover", () => {
		renderSpaceMemberRow({
			entry: buildHumanEntry({
				lastSeenLabel: "Seen 7 hours ago",
				liveNow: false,
				presenceLabel: "seen 7 hours ago",
				lastSeenAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
				presenceStatus: "offline",
			}),
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Check Felix Profile" })
		);
		const dialog = within(screen.getByRole("dialog"));
		expect(dialog.getByText("Here 7h ago")).toBeTruthy();
		expect(dialog.getByText("You")).toBeTruthy();
		expect(dialog.queryByText("Active in this Space")).toBeNull();
		expect(
			dialog
				.getByRole("link", { name: "View Felix profile" })
				.getAttribute("href")
		).toBe("/o/acme/people/human-1");
	});

	it("links another person to their People detail page", () => {
		renderSpaceMemberRow({
			currentProfileId: "human-current",
			entry: buildHumanEntry({
				lastSeenLabel: "Seen 7 hours ago",
				liveNow: false,
				ownerDisplay: "Monica Cheng",
				ownerName: "Monica Cheng",
				ownerUserId: "user-monica",
				profileId: "human-monica",
				profileName: "Monica Cheng",
			}),
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Check Monica Cheng Profile" })
		);
		const dialog = within(screen.getByRole("dialog"));
		expect(
			dialog
				.getByRole("link", { name: "View Monica Cheng profile" })
				.getAttribute("href")
		).toBe("/o/acme/people/human-monica");
		expect(dialog.queryByText("You")).toBeNull();
	});

	it("does not fill a compact person row with a generic Human label", () => {
		renderSpaceMemberRow({
			currentProfileId: "human-current",
			density: "compact",
			entry: buildHumanEntry({
				lastSeenLabel: null,
				liveNow: false,
				presenceLabel: null,
				presenceStatus: null,
			}),
		});

		expect(screen.queryByText("Human")).toBeNull();
	});

	it("does not label an agent profile as you", () => {
		renderSpaceMemberRow({
			currentProfileId: "agt-1",
			entry: buildAgentEntry(),
		});

		expect(screen.queryByTestId("space-member-self-status")).toBeNull();
	});

	it("does not let live presence override recovery state", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildConnectControllerPlan(),
			entry: buildAgentEntry({
				liveNow: true,
				presenceStatus: "live",
			}),
		});

		expect(screen.queryByText("Connected to Office Mac")).toBeNull();
		expect(screen.queryByText("Available for Wake")).toBeNull();
		expect(getAgentAvailabilityIndicatorDot().className).toContain(
			"bg-muted-foreground"
		);
		expect(getAgentAvailabilityIndicator().getAttribute("aria-label")).toBe(
			"Manually controlled"
		);
		expect(screen.queryByText("Manually controlled")).toBeNull();
		expect(screen.queryByText("No local agent selected for Wake")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Connect local agent" })
		).toBeNull();
	});

	it("keeps active Wake service waiting out of the long-term status indicator", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildServiceConnectionPlan(),
			memberTransientState: "active_wake_waiting_for_service",
		});

		// The per-agent computer-level reconnect action is covered below. This case
		// only asserts the transient-state messaging.
		expect(screen.queryByText("Waiting for OpenMeld Service")).toBeNull();
		expect(
			screen.getByText("A Wake is waiting for the computer to reconnect.")
		).toBeTruthy();
	});

	it("keeps active Wake waiting in the compact status indicator", () => {
		renderSpaceMemberRow({
			density: "compact",
			agentRecoveryPlan: buildServiceConnectionPlan(),
			memberTransientState: "active_wake_waiting_for_service",
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.getAttribute("aria-label")).toBe("Waiting");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Wake waiting for this computer to reconnect"
		);
		expect(
			screen.queryByText("A Wake is waiting for the computer to reconnect.")
		).toBeNull();
	});

	it.each([
		"default",
		"compact",
	] as const)("shows transient readiness checks at %s density without hard disconnect guidance", (density) => {
		renderSpaceMemberRow({
			density,
			agentRecoveryPlan: buildServiceConnectionPlan(),
			memberTransientState: "checking",
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Checking");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Checking Wake availability"
		);
		expect(indicator.getAttribute("data-refreshing")).toBe("true");
		expect(getAgentAvailabilityIndicatorDot().className).toContain("bg-sky-");
		expect(screen.queryByText("Service not connected")).toBeNull();
		expect(indicator.tabIndex).toBe(0);
		expect(
			Boolean(
				screen.queryByText(
					"OpenMeld is checking this agent's local connection."
				)
			)
		).toBe(density === "default");
	});

	it.each([
		"default",
		"compact",
	] as const)("shows active Wake progress at %s density over hard Connect availability", (density) => {
		renderSpaceMemberRow({
			density,
			agentRecoveryPlan: buildConnectControllerPlan(),
			entry: buildAgentEntry({
				availabilityAction: "reconnect_binding",
				availabilityBadgeLabel: "Connect",
				availabilityCategory: "unavailable",
				availabilityPhase: "connect_local_agent",
				availabilityReasonCode: "agent_profile_binding.missing",
				availabilitySummary:
					"Connect a local agent before this profile can reply.",
				availabilityTooltip: "Connect local agent",
				presenceLabel: "unavailable",
				presenceStatus: "unavailable",
			}),
			memberTransientState:
				"active_wake_in_progress" as SpaceWakeStatusTransientState,
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Working");
		expect(indicator.getAttribute("aria-description")).toBe("Wake in progress");
		expect(indicator.getAttribute("data-refreshing")).toBe("true");
		expect(screen.queryByText("Connect local agent")).toBeNull();
		expect(
			Boolean(
				screen.queryByText("This agent is working on a Wake in this Space.")
			)
		).toBe(density === "default");
		expect(screen.queryByText("Wake in progress")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Connect local agent" })
		).toBeNull();
	});

	it("shows a Wake queued behind a task in its folder as waiting, not working", () => {
		renderSpaceMemberRow({
			entry: buildAgentEntry({
				presenceLabel: "wakeable",
				presenceStatus: "wakeable",
			}),
			memberTransientState:
				"active_wake_waiting_for_folder" as SpaceWakeStatusTransientState,
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.getAttribute("aria-label")).toBe("Waiting");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Waiting for another task in its folder to finish"
		);
		expect(
			screen.queryByText("This agent is working on a Wake in this Space.")
		).toBeNull();
	});

	it("labels route reconnect recovery without service disconnect wording", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildRouteReconnectPlan(),
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Reconnecting",
				availabilityReasonCode: "route.not_registered",
				availabilityTooltip: "Codex is reconnecting",
			}),
		});

		expect(getAgentAvailabilityIndicator().getAttribute("aria-label")).toBe(
			"Reconnecting"
		);
		expect(screen.queryByText("Reconnecting")).toBeNull();
		expect(screen.queryByText("Service not connected")).toBeNull();
		expect(screen.queryByText("Reconnecting local reply route")).toBeNull();
		expect(
			screen.queryByRole("link", { name: "Reconnect Computer" })
		).toBeNull();
		expect(screen.queryByRole("link", { name: "Check status" })).toBeNull();
	});

	it("does not let stale route recovery hide a wakeable Space member", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildRouteReconnectPlan(),
			entry: buildAgentEntry({
				presenceLabel: "wakeable",
				presenceStatus: "wakeable",
			}),
		});

		expect(getAgentAvailabilityIndicator().getAttribute("aria-label")).toBe(
			"Available"
		);
		expect(screen.queryByText("Reconnecting")).toBeNull();
		expect(screen.queryByText("Reconnect Computer")).toBeNull();
		expect(screen.queryByText("Reconnecting local reply route")).toBeNull();
	});

	it("does not let owner checking diagnostics override a wakeable Space member", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildServiceConnectionPlan(),
			entry: buildAgentEntry({
				presenceLabel: "wakeable",
				presenceStatus: "wakeable",
			}),
			memberTransientState: "checking",
		});

		expect(getAgentAvailabilityIndicator().getAttribute("aria-label")).toBe(
			"Available"
		);
		expect(screen.getByText("Connected to Office Mac")).toBeTruthy();
		expect(screen.queryByText("Checking")).toBeNull();
		expect(
			screen.queryByText("OpenMeld is checking this agent's local connection.")
		).toBeNull();
		expect(screen.queryByText("Reconnect Computer")).toBeNull();
	});

	it("does not let owner checking diagnostics override shared AgentWakeAvailability", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildServiceConnectionPlan(),
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Available",
				availabilityIsRefreshing: false,
				availabilityTooltip: "Available for Wake",
				presenceLabel: "wakeable",
				presenceStatus: "wakeable",
			}),
			memberTransientState: "checking",
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Available");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Available for Wake"
		);
		expect(indicator.getAttribute("data-refreshing")).toBeNull();
		expect(screen.queryByText("Checking")).toBeNull();
		expect(
			screen.queryByText("OpenMeld is checking this agent's local connection.")
		).toBeNull();
	});

	it("keeps active Wake service waiting visible for a wakeable Space member", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildServiceConnectionPlan(),
			entry: buildAgentEntry({
				presenceLabel: "wakeable",
				presenceStatus: "wakeable",
			}),
			memberTransientState: "active_wake_waiting_for_service",
		});

		expect(getAgentAvailabilityIndicator().getAttribute("aria-label")).toBe(
			"Available"
		);
		expect(
			screen.getByText("A Wake is waiting for the computer to reconnect.")
		).toBeTruthy();
		expect(screen.queryByText("Connected to Office Mac")).toBeNull();
	});

	it("suppresses the per-agent computer-level reconnect action because the Get-set-up banner owns it", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildServiceConnectionPlan(),
			memberTransientState: null,
		});

		expect(
			screen.queryByRole("link", { name: "Reconnect Computer" })
		).toBeNull();
		expect(
			screen
				.getByTestId("space-agent-availability-indicator")
				.getAttribute("aria-description")
		).toBe("Codex’s computer is disconnected");
		expect(screen.queryByText("OpenMeld Service is not connected")).toBeNull();
	});

	it("keeps controller.binding.disabled indicator, tooltip, and detail copy aligned", () => {
		const copy =
			"Codex already has a local agent connection, but that connection is turned off. Turn it on, then wake the agent again.";
		renderSpaceMemberRow({
			agentRecoveryPlan: buildDisabledBindingPlan(),
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Unavailable",
				availabilityCategory: "unavailable",
				availabilityReasonCode: "controller.binding.disabled",
				availabilityTooltip: copy,
				presenceStatus: "unavailable",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Unavailable");
		expect(indicator.getAttribute("aria-description")).toBe(copy);
		expect(screen.queryByText(copy)).toBeNull();
		expect(screen.queryByText("Turned off")).toBeNull();
	});

	it("keeps provider subscription indicator, tooltip, and detail copy aligned", () => {
		const copy =
			"Claude Smoke Agent is connected, but its provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.";
		renderSpaceMemberRow({
			agentRecoveryPlan: buildProviderSubscriptionPlan(),
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Unavailable",
				availabilityCategory: "unavailable",
				availabilityReasonCode:
					"provider_account.subscription_access_unavailable",
				availabilityTooltip: copy,
				controllerDisplayName: "Claude Code",
				agentControllerRef: "builtin:claude-code",
				presenceStatus: "unavailable",
				profileName: "Claude Smoke Agent",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Unavailable");
		expect(indicator.getAttribute("aria-description")).toBe(copy);
		expect(screen.queryByText(copy)).toBeNull();
		expect(screen.queryByText("Claude Code subscription needed")).toBeNull();
		expect(screen.queryByText("Account attention")).toBeNull();
	});

	it("does not synthesize a recovery label for the status indicator", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildProviderSubscriptionPlan(),
			entry: buildAgentEntry({
				availabilityCategory: "unavailable",
				availabilityReasonCode:
					"provider_account.subscription_access_unavailable",
				presenceStatus: "unavailable",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Unavailable");
		expect(screen.queryByText("Claude Code subscription needed")).toBeNull();
	});

	it("keeps only the status dot: no recovery text or action on the row", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildDisabledBindingPlan(),
			density: "compact",
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Unavailable",
				availabilityCategory: "unavailable",
				availabilityReasonCode: "controller.binding.disabled",
				availabilitySummary: "Turn on this Agent's local agent.",
				presenceStatus: "unavailable",
			}),
		});

		expect(getAgentAvailabilityIndicator().getAttribute("aria-label")).toBe(
			"Unavailable"
		);
		expect(screen.queryByText("Turn on this Agent's local agent.")).toBeNull();
		expect(screen.queryByText("Needs attention")).toBeNull();
		expect(screen.queryByText("Needs connection")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Turn on local agent" })
		).toBeNull();
	});

	it("does not show the active Wake waiting note after terminal Wake cleanup", () => {
		renderSpaceMemberRow({
			memberTransientState: null,
		});

		expect(getAgentAvailabilityIndicator().getAttribute("aria-label")).toBe(
			"Checking"
		);
		expect(
			screen.queryByText("A Wake is waiting for the computer to reconnect.")
		).toBeNull();
	});

	it("uses warning and muted dots for inactive public agent states", () => {
		const { rerender } = renderSpaceMemberRow({
			entry: buildAgentEntry({
				presenceLabel: "reply route unavailable",
				presenceStatus: "unavailable",
			}),
		});

		expect(getAgentAvailabilityIndicatorDot().className).toContain("bg-amber-");
		expect(getProfileNameElement("Codex")?.className).toContain(
			"text-muted-foreground"
		);

		rerender(
			<SpaceMemberRow
				agentRecoveryPlan={null}
				currentOwnerUserId="user-1"
				currentProfileId="human-1"
				entry={buildAgentEntry({
					presenceLabel: "offline",
					presenceStatus: "offline",
				})}
				isAgentWakeAvailabilityCheckPending={false}
				memberTransientState={null}
				onCheckAgentWakeAvailability={vi.fn()}
				orgSlug="acme"
				variant="full"
			/>
		);

		expect(getAgentAvailabilityIndicatorDot().className).toContain(
			"bg-muted-foreground"
		);
		expect(getProfileNameElement("Codex")?.className).toContain(
			"text-muted-foreground"
		);
	});

	it("keeps Offline muted when local service recovery is available", () => {
		renderSpaceMemberRow({
			agentRecoveryPlan: buildServiceConnectionPlan(),
			entry: buildAgentEntry({
				availabilityBadgeLabel: "Offline",
				availabilityCategory: "offline",
				availabilityPhase: "offline",
				availabilityReasonCode: "local_service.not_connected_for_account",
				availabilitySummary:
					"OpenMeld Service is not connected for this account.",
				availabilityTooltip: "Offline",
				presenceLabel: "offline",
				presenceStatus: "offline",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Offline");
		expect(getAgentAvailabilityIndicatorDot().className).toContain(
			"bg-muted-foreground"
		);
		expect(
			screen.getByText("OpenMeld Service is not connected for this account.")
		).toBeTruthy();
	});

	it.each([
		"default",
		"compact",
	] as const)("shows Checking connection at %s density as a distinct public agent state", (density) => {
		renderSpaceMemberRow({
			density,
			entry: buildAgentEntry({
				presenceLabel: "checking connection",
				presenceStatus: "checking_connection",
			}),
		});

		const indicator = getAgentAvailabilityIndicator();
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Checking");
		expect(getAgentAvailabilityIndicatorDot().className).toContain("bg-sky-");
		expect(indicator.getAttribute("aria-description")).toBe(
			"Checking Wake availability"
		);
		expect(
			Boolean(
				screen.queryByText(
					"OpenMeld is checking this agent's local connection."
				)
			)
		).toBe(density === "default");
		expect(getProfileNameElement("Codex")?.className).toContain(
			"text-foreground"
		);
	});
});

function getAgentAvailabilityIndicator(): HTMLElement {
	return screen.getByTestId("space-agent-availability-indicator");
}

function getAgentAvailabilityIndicatorDot(): HTMLElement {
	const indicatorDot = getAgentAvailabilityIndicator().querySelector(
		'[data-slot="space-agent-availability-indicator-dot"]'
	);
	if (!(indicatorDot instanceof HTMLElement)) {
		throw new Error("Expected the Agent availability indicator dot to render.");
	}
	return indicatorDot;
}

function getProfileNameElement(profileName: string): HTMLElement {
	const profileNameElement = screen
		.getByRole("button", { name: `Check ${profileName} Profile` })
		.querySelector(":scope > span:last-child");
	if (!(profileNameElement instanceof HTMLElement)) {
		throw new Error(`Expected the profile name to render: ${profileName}`);
	}
	return profileNameElement;
}

function renderSpaceMemberRow(input: {
	agentRecoveryPlan?: AgentProfileReplyRecoveryPlan | null;
	centerAgentProfileId?: string | null;
	currentOwnerUserId?: string | null;
	currentProfileId?: string;
	density?: "compact" | "default";
	entry?: SpaceMemberDirectoryEntry;
	isAgentWakeAvailabilityCheckPending?: boolean;
	memberTransientState?: SpaceWakeStatusTransientState | null;
	modelCatalog?: ModelCatalog | null;
	onCheckAgentWakeAvailability?: (profileId: string) => Promise<void>;
	onRemoveFromSpace?: (profileId: string) => Promise<{
		alreadyAbsentCount: number;
		removedCount: number;
	}>;
}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<SpaceMemberRow
			agentRecoveryPlan={input.agentRecoveryPlan ?? null}
			centerAgentProfileId={input.centerAgentProfileId ?? null}
			currentOwnerUserId={input.currentOwnerUserId ?? "user-1"}
			currentProfileId={input.currentProfileId ?? "human-1"}
			density={input.density}
			entry={input.entry ?? buildAgentEntry()}
			isAgentWakeAvailabilityCheckPending={
				input.isAgentWakeAvailabilityCheckPending ?? false
			}
			memberTransientState={input.memberTransientState ?? null}
			modelCatalog={input.modelCatalog ?? null}
			onCheckAgentWakeAvailability={
				input.onCheckAgentWakeAvailability ?? vi.fn(async () => undefined)
			}
			onRemoveFromSpace={input.onRemoveFromSpace}
			orgSlug="acme"
			variant="full"
		/>,
		{
			wrapper: ({ children }) => (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			),
		}
	);
}

function buildModelCatalog(): ModelCatalog {
	return {
		agentControllers: {
			codex: {
				defaultModelId: "gpt-5.5",
				models: [
					{
						displayName: "GPT-5.5",
						id: "gpt-5.5",
						minCliVersion: null,
						supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
						unavailable: false,
					},
					{
						displayName: "GPT-5.4",
						id: "gpt-5.4",
						minCliVersion: null,
						supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
						unavailable: false,
					},
				],
			},
		},
		schemaVersion: 1,
		updatedAt: "2026-06-18T00:00:00.000Z",
	};
}

function buildAgentEntry(
	overrides: Partial<SpaceMemberDirectoryEntry> = {}
): SpaceMemberDirectoryEntry {
	return {
		addedByDisplayName: null,
		addedByProfileId: null,
		avatarUrl: null,
		agentControllerConversationId: null,
		agentControllerPermissionMode: null,
		controllerDisplayName: "Codex",
		agentControllerRef: "builtin:codex",
		availabilityAction: null,
		availabilityBadgeLabel: null,
		availabilityCategory: null,
		availabilityIsRefreshing: false,
		availabilityPhase: null,
		availabilityReasonCode: null,
		availabilitySummary: null,
		availabilityTooltip: null,
		id: "agt-1",
		lastSeenLabel: null,
		liveNow: false,
		manualParticipationOnly: false,
		mentionLabel: "@codex(wake)",
		modelSelection: {
			modelId: "gpt-5.3-codex-spark",
			reasoningLevel: "high",
		},
		ownerDisplay: "Felix",
		ownerName: "Felix",
		ownerUserId: "user-1",
		presenceLabel: "checking connection",
		presenceStatus: "checking_connection",
		profileId: "agt-1",
		profileKind: "agent",
		profileName: "Codex",
		runtimeDeviceDisplayName: "Office Mac",
		searchText: "codex",
		workingDirectory: null,
		...overrides,
	};
}

function buildHumanEntry(
	overrides: Partial<SpaceMemberDirectoryEntry> = {}
): SpaceMemberDirectoryEntry {
	return {
		addedByDisplayName: null,
		addedByProfileId: null,
		avatarUrl: null,
		agentControllerConversationId: null,
		agentControllerPermissionMode: null,
		controllerDisplayName: null,
		agentControllerRef: null,
		availabilityAction: null,
		availabilityBadgeLabel: null,
		availabilityCategory: null,
		availabilityIsRefreshing: false,
		availabilityPhase: null,
		availabilityReasonCode: null,
		availabilitySummary: null,
		availabilityTooltip: null,
		id: "human-1",
		lastSeenLabel: null,
		liveNow: true,
		manualParticipationOnly: false,
		mentionLabel: null,
		modelSelection: null,
		ownerDisplay: "Felix",
		ownerName: "Felix",
		ownerUserId: "user-1",
		presenceLabel: "live now",
		presenceStatus: "live",
		profileId: "human-1",
		profileKind: "human",
		profileName: "Felix",
		runtimeDeviceDisplayName: null,
		searchText: "felix",
		workingDirectory: null,
		...overrides,
	};
}

function buildConnectControllerPlan(): AgentProfileReplyRecoveryPlan {
	return {
		agentDisplayName: "Codex",
		agentId: "codex",
		body: "Codex is in this space, and Codex is available on this computer.",
		agentControllerRef: "builtin:codex",
		kind: "connect_controller",
		primaryActionId: "connect_local_agent",
		primaryActionLabel: "Connect local agent",
		profileId: "agt-1",
		profileName: "Codex",
		recoveryReasonCode: "agent_profile_binding.missing",
		secondaryLabel: "Not connected to a local agent yet",
		title: "Codex is not connected",
	};
}

function buildConflictPlan(): AgentProfileReplyRecoveryPlan {
	return {
		body: "Codex shares a reply conversation with another Agent Profile. Review agent settings and choose one Agent Profile to keep this reply conversation.",
		kind: "review_agent_profile",
		primaryActionId: "review_agent_settings",
		primaryActionLabel: "Review agent settings",
		profileId: "agt-1",
		profileName: "Codex",
		recoveryReasonCode:
			"agent_profile_binding.controller_conversation_conflict",
		secondaryLabel: "Duplicate reply conversation",
		title: "Codex has a duplicate reply conversation",
	};
}

function buildServiceConnectionPlan(): AgentProfileReplyRecoveryPlan {
	return {
		body: "Codex’s computer is disconnected from OpenMeld. Reconnect the computer so it can receive local Wake work.",
		kind: "review_computer",
		primaryActionId: "reconnect_openmeld_service",
		primaryActionLabel: "Reconnect Computer",
		profileId: "agt-1",
		profileName: "Codex",
		recoveryReasonCode: "local_service.not_connected_for_account",
		secondaryLabel: "Computer not connected",
		title: "Codex’s computer is disconnected",
	};
}

function buildPreparePlan(): AgentProfileReplyRecoveryPlan {
	return {
		body: "Codex is connected, but OpenMeld has no current local agent report from its computer. Check the local agent’s status on that computer.",
		kind: "prepare_agent_profile",
		primaryActionId: "check_status",
		primaryActionLabel: "Check status",
		profileId: "agt-1",
		profileName: "Codex",
		recoveryReasonCode: "agent_profile_binding.agent_controller_report_missing",
		secondaryLabel: "Needs setup on this computer",
		title: "Codex needs setup on this computer",
	};
}

function buildRouteReconnectPlan(): AgentProfileReplyRecoveryPlan {
	return {
		body: "Codex is connected, but OpenMeld cannot see an active local Wake route from this computer yet.",
		kind: "review_computer",
		primaryActionId: "check_status",
		primaryActionLabel: "Check status",
		profileId: "agt-1",
		profileName: "Codex",
		recoveryReasonCode: "route.not_registered",
		secondaryLabel: "Reconnecting local reply route",
		title: "Codex is reconnecting",
	};
}

function buildProviderSubscriptionPlan(): AgentProfileReplyRecoveryPlan {
	const copy =
		"Claude Smoke Agent is connected, but its provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.";
	return {
		body: copy,
		kind: "review_provider_account",
		primaryActionId: "review_agent_settings",
		primaryActionLabel: "Review agent settings",
		profileId: "agt-1",
		profileName: "Claude Smoke Agent",
		recoveryReasonCode: "provider_account.subscription_access_unavailable",
		secondaryLabel: copy,
		title: copy,
	};
}

function buildDisabledBindingPlan(): AgentProfileReplyRecoveryPlan {
	const copy =
		"Codex already has a local agent connection, but that connection is turned off. Turn it on, then wake the agent again.";
	return {
		agentControllerRef: "builtin:codex",
		body: copy,
		kind: "turn_on_controller",
		primaryActionId: "turn_on_local_agent",
		primaryActionLabel: "Turn on local agent",
		profileId: "agt-1",
		profileName: "Codex",
		recoveryReasonCode: "controller.binding.disabled",
		secondaryLabel: copy,
		title: copy,
	};
}

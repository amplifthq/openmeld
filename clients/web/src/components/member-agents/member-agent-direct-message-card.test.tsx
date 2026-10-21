import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import { MEMBER_AGENT_WELCOME_PERMISSION_MODE_LINE } from "@openmeld/agent-runtime";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceAgentRecoveryProvider } from "#/components/spaces/space-agent-recovery-context";
import type { DirectMessageMemberAgent } from "./member-agent-chat-history";
import {
	MemberAgentDirectMessageCard,
	type MemberAgentDirectMessageCardModel,
	nextSettledDirectMessageCard,
	resolveMemberAgentDirectMessageCard,
	type SettledDirectMessageCard,
	visibleDirectMessageCardModel,
} from "./member-agent-direct-message-card";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

function entry(
	overrides: Partial<SpaceMemberDirectoryEntry>
): SpaceMemberDirectoryEntry {
	return {
		agentControllerRef: "builtin:claude-code",
		availabilityCategory: "available",
		availabilitySummary: null,
		modelSelection: null,
		runtimeDeviceDisplayName: "Felix’s MacBook",
		workingDirectory: null,
		...overrides,
	} as SpaceMemberDirectoryEntry;
}

const FAILURE_WORD_PATTERN = /fail/i;

describe("MemberAgent Direct Message card", () => {
	it("welcomes with computer, model, folder when known, and the permission line", () => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({
					agentControllerPermissionMode: "claude-code:default",
					workingDirectory: "~/code/openmeld",
				}),
				modelCatalog: null,
			})
		).toEqual({
			kind: "welcome",
			title: "Ready to work",
			details: [
				{ label: "Computer", value: "Felix’s MacBook" },
				{ label: "Default model", value: "The harness default" },
				{ label: "Default folder", value: "~/code/openmeld" },
			],
			note: MEMBER_AGENT_WELCOME_PERMISSION_MODE_LINE,
		});
	});

	it.each([
		["offline", "offline", "Offline"],
		["unavailable", "repair", "Needs attention"],
	])("shows one %s card", (category, kind, title) => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ availabilityCategory: category }),
				modelCatalog: null,
			})
		).toMatchObject({ kind, title });
	});

	it.each([
		"checking",
		null,
	])("shows no card while readiness is %s", (category) => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ availabilityCategory: category }),
				modelCatalog: null,
			})
		).toBeNull();
	});

	it("names the shared readiness reason for any other unavailable state", () => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({
					availabilityBadgeLabel: "Local agent not installed",
					availabilityCategory: "unavailable",
					availabilityReasonCode: "controller.not_installed",
					availabilitySummary: "Install this local agent on its Computer.",
				}),
				modelCatalog: null,
			})
		).toEqual({
			kind: "repair",
			title: "Local agent not installed",
			description: "Install this local agent on its Computer.",
		});
	});

	it("says a set-up folder that can't be used now may have been moved or deleted", () => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({
					availabilityBadgeLabel: "Working folder unavailable",
					availabilityCategory: "unavailable",
					availabilityReasonCode: "profile.workspace.invalid",
					availabilitySummary: "Review this Agent’s working folder.",
				}),
				modelCatalog: null,
			})
		).toEqual({
			kind: "repair",
			title: "Working folder unavailable",
			description:
				"This Agent can’t use its working folder. It may have been moved or deleted.",
		});
	});

	it("names a non-default permission mode instead of promising prompts", () => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({
					agentControllerRef: "builtin:codex",
					agentControllerPermissionMode: "codex:fullAccess",
				}),
				modelCatalog: null,
			})
		).toMatchObject({
			kind: "welcome",
			note: "Permission mode is Full access.",
		});
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ agentControllerPermissionMode: null }),
				modelCatalog: null,
			})
		).toMatchObject({ kind: "welcome", note: null });
	});

	it("uses Core's public Wakeability reason for the repair card", () => {
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ availabilityCategory: "unavailable" }),
				modelCatalog: null,
				reason: { code: "version_too_old", modelId: "claude-opus-5-5" },
			})
		).toMatchObject({
			kind: "repair",
			title: "Update needed",
			description:
				"The installed harness can’t run claude-opus-5-5. Update it on its computer, or choose another model.",
		});
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: entry({ availabilityCategory: "offline" }),
				modelCatalog: null,
				reason: { code: "computer_offline" },
			})
		).toMatchObject({ kind: "offline" });
	});

	it("asks for a working folder before the first task, not after a failure", () => {
		const missing = entry({
			availabilityCategory: "unavailable",
			availabilityReasonCode: "profile.workspace.missing",
			availabilitySummary: "Choose a working folder for this Agent.",
		});
		expect(
			resolveMemberAgentDirectMessageCard({
				entry: missing,
				modelCatalog: null,
				hasMessages: false,
			})
		).toEqual({
			kind: "repair",
			title: "Working folder missing",
			description: "Choose a working folder before the first task.",
		});
		const card = resolveMemberAgentDirectMessageCard({
			entry: missing,
			modelCatalog: null,
			hasMessages: true,
		});
		expect(card).toMatchObject({
			description: "Choose a working folder before the next task.",
		});
		expect(JSON.stringify(card)).not.toMatch(FAILURE_WORD_PATTERN);
	});
});

describe("MemberAgent Direct Message card across readiness reads", () => {
	const welcome = resolveMemberAgentDirectMessageCard({
		entry: entry({}),
		modelCatalog: null,
	});
	const missing = resolveMemberAgentDirectMessageCard({
		entry: entry({
			availabilityCategory: "unavailable",
			availabilityReasonCode: "profile.workspace.missing",
		}),
		modelCatalog: null,
	});
	function replay(
		reads: readonly (MemberAgentDirectMessageCardModel | null)[],
		key = "agt-1"
	): SettledDirectMessageCard {
		let settled: SettledDirectMessageCard | null = null;
		for (const model of reads) {
			settled = nextSettledDirectMessageCard(settled, { key, model });
		}
		if (!settled) {
			throw new Error("No reads");
		}
		return settled;
	}

	it("shows nothing while checking and posts no welcome after the check", () => {
		expect(visibleDirectMessageCardModel(replay([null]), false)).toBeNull();
		expect(
			visibleDirectMessageCardModel(replay([null, welcome]), false)
		).toBeNull();
	});

	it("welcomes an Agent that was ready on arrival, in an empty Session only", () => {
		expect(visibleDirectMessageCardModel(replay([welcome]), false)).toEqual(
			welcome
		);
		expect(visibleDirectMessageCardModel(replay([welcome]), true)).toBeNull();
	});

	it("shows a problem once it settles and keeps it through a background refresh", () => {
		expect(
			visibleDirectMessageCardModel(replay([null, missing]), true)
		).toEqual(missing);
		expect(
			visibleDirectMessageCardModel(replay([missing, null, null]), true)
		).toEqual(missing);
	});

	it("does not flash a problem while a ready Agent refreshes", () => {
		expect(
			visibleDirectMessageCardModel(replay([welcome, null, welcome]), true)
		).toBeNull();
	});

	it("starts over for another Agent's Direct Message", () => {
		const first = replay([missing]);
		const other = nextSettledDirectMessageCard(first, {
			key: "agt-2",
			model: null,
		});
		expect(visibleDirectMessageCardModel(other, true)).toBeNull();
		// While the Direct Message Agent is not known yet, nothing changes.
		expect(
			nextSettledDirectMessageCard(first, { key: null, model: null })
		).toBe(first);
	});
});

describe("MemberAgent Direct Message card view", () => {
	afterEach(cleanup);

	const current = {
		agentProfileId: "agt-1",
		memberAgent: { displayName: "Felix Lu’s Codex" },
	} as DirectMessageMemberAgent;
	const plan: AgentProfileReplyRecoveryPlan = {
		body: "Codex is connected, but OpenMeld has no current local agent report from its computer.",
		kind: "prepare_agent_profile",
		primaryActionId: "check_status",
		primaryActionLabel: "Check status",
		profileId: "agt-1",
		profileName: "Codex",
		recoveryReasonCode: "agent_profile_binding.agent_controller_report_missing",
		secondaryLabel: "Needs setup on this computer",
		title: "Codex needs setup on this computer",
	};

	it("is posted by the Agent and carries the fix in its body", () => {
		const cardEntry = entry({
			agentControllerRef: "builtin:codex",
			availabilityBadgeLabel: "Setup needed",
			availabilityCategory: "unavailable",
			availabilitySummary: "Check this local agent on its Computer.",
			profileId: "agt-1",
			profileName: "Codex",
		});
		const cardModel = resolveMemberAgentDirectMessageCard({
			entry: cardEntry,
			modelCatalog: null,
		});
		if (!cardModel) {
			throw new Error("Expected a card");
		}
		render(
			<QueryClientProvider client={new QueryClient()}>
				<SpaceAgentRecoveryProvider
					isAgentRecoveryPending={() => false}
					onAgentRecoveryAction={vi.fn(async () => undefined)}
					orgSlug="acme"
					plansByProfileId={new Map([["agt-1", plan]])}
				>
					<MemberAgentDirectMessageCard
						current={current}
						entry={cardEntry}
						model={cardModel}
					/>
				</SpaceAgentRecoveryProvider>
			</QueryClientProvider>
		);

		const header = document.querySelector("[data-slot='message-header']");
		expect(header?.textContent).toContain("Felix Lu’s Codex");
		expect(header?.querySelector("time")).toBeTruthy();
		const card = screen.getByRole("region", { name: "Setup needed" });
		expect(
			within(card).getByText("Check this local agent on its Computer.")
		).toBeTruthy();
		expect(
			within(card)
				.getByRole("link", { name: "Check status" })
				.getAttribute("href")
		).toBe("/o/acme/computers");
	});
});

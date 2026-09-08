import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
	AgentWakeAvailabilityStatus,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { requireCurrentSpaceComposerWakeAdmission } from "./space-composer-wake-admission";

const AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("current Space Composer Wake admission", () => {
	it("admits an explicit offline device wait without changing Wakeability", async () => {
		const snapshot = createMembersSnapshot("offline_for_wake", false);
		const agent = snapshot.agents[0];
		if (!agent) {
			throw new Error("Expected an agent fixture.");
		}
		agent.deviceWaitTarget = {
			bindingId: "binding-1",
			openMeldServiceRuntimeId: "runtime-1",
		};
		const deviceWait = {
			...agent.deviceWaitTarget,
			targetProfileId: AGENT_PROFILE_ID,
			deadlineAtMs: Date.now() + 60_000,
		};
		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				deviceWait,
				readCurrentMembers: async () => snapshot,
			})
		).resolves.toBeUndefined();
		expect(agent.agentWakeAvailability?.status).toBe("offline_for_wake");
		if (agent.agentWakeAvailability) {
			agent.agentWakeAvailability = {
				...agent.agentWakeAvailability,
				category: "checking",
				isRefreshing: true,
				reasonCode: "local_service.reconnecting",
				status: "checking_connection",
			};
		}
		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				deviceWait,
				readCurrentMembers: async () => snapshot,
			})
		).resolves.toBeUndefined();
		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				deviceWait: { ...deviceWait, bindingId: "another-binding" },
				readCurrentMembers: async () => snapshot,
			})
		).rejects.toMatchObject({ code: "addressing.wake_blocked" });
		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				deviceWait: { ...deviceWait, deadlineAtMs: Date.now() - 1 },
				readCurrentMembers: async () => snapshot,
			})
		).rejects.toMatchObject({ code: "addressing.wake_blocked" });
	});
	it("does not read Wakeability for a message containing only References", async () => {
		const readCurrentMembers = vi.fn();

		await requireCurrentSpaceComposerWakeAdmission({
			agentProfileIds: [],
			readCurrentMembers,
		});

		expect(readCurrentMembers).not.toHaveBeenCalled();
	});

	it("admits a Wake only from a current non-refreshing Core projection", async () => {
		const readCurrentMembers = vi
			.fn()
			.mockResolvedValue(createMembersSnapshot("available_for_wake", false));

		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				readCurrentMembers,
			})
		).resolves.toBeUndefined();
		expect(readCurrentMembers).toHaveBeenCalledOnce();
	});

	it("does not let a refreshing Available display authorize a new Wake", async () => {
		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				readCurrentMembers: async () =>
					createMembersSnapshot("available_for_wake", true),
			})
		).rejects.toMatchObject({
			code: "addressing.wake_blocked",
			targetProfileId: AGENT_PROFILE_ID,
		});
	});

	it("uses the Core-owned blocked reason and fails closed when a verdict is absent", async () => {
		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				readCurrentMembers: async () =>
					createMembersSnapshot("offline_for_wake", false),
			})
		).rejects.toMatchObject({
			code: "addressing.wake_blocked",
			message: "Connect your computer before Runner can reply.",
			targetProfileId: AGENT_PROFILE_ID,
		});

		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				readCurrentMembers: async () => createSpaceMembersSnapshot(),
			})
		).rejects.toMatchObject({
			code: "addressing.wake_blocked",
			targetProfileId: null,
		});

		await expect(
			requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [AGENT_PROFILE_ID],
				readCurrentMembers: () =>
					Promise.reject(new Error("network unavailable")),
			})
		).rejects.toMatchObject({
			code: "addressing.wake_blocked",
			message:
				"OpenMeld couldn't confirm that this agent can reply right now. Try again.",
			targetProfileId: null,
		});
	});
});

function createMembersSnapshot(
	status: AgentWakeAvailabilityStatus,
	isRefreshing: boolean
): SpaceMembersSnapshot {
	const agent = createSpaceMemberAgentSnapshot({
		agentWakeAvailability: { status },
		profileId: AGENT_PROFILE_ID,
		profileName: "Runner",
	});
	const availability = agent.agentWakeAvailability;
	if (!availability) {
		throw new Error("Expected the Agent fixture to include Wake availability.");
	}
	return createSpaceMembersSnapshot({
		agents: [
			{
				...agent,
				agentWakeAvailability: {
					...availability,
					isRefreshing,
					summary:
						status === "available_for_wake"
							? "Available for Wake"
							: "Connect your computer before Runner can reply.",
				},
			},
		],
	});
}

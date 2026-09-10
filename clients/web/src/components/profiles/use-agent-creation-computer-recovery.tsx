"use client";

import { daemonServiceLaneSchema } from "@openmeld/schemas/schemas";
import { Button } from "@openmeld/ui/components/button";
import { useEffect, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { BringAgentsSetupProvider } from "#/components/connect/bring-agents-setup-context";
import { ComputerSetupFlow } from "#/components/connect/start-bring-agents-setup-page";
import type { resolveLocalAgentCreationGuidance } from "#/lib/profiles/local-agent-creation-guidance";
import type { AgentCreationComputerRecovery } from "./agent-creation-computer-recovery";

type SetupTarget = {
	connectedComputerId?: string;
	name?: string;
	state?: AgentCreationComputerRecovery["state"];
};

type RecoveryInput = {
	enabled: boolean;
	orgSlug?: string;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
	guidance: ReturnType<typeof resolveLocalAgentCreationGuidance>;
	hasLocalAgents: boolean;
	isPending: boolean;
	sessionComputerId?: string;
	onRetry: () => void;
};

export function useAgentCreationComputerRecovery(input: RecoveryInput) {
	const [setupTarget, setSetupTarget] = useState<SetupTarget | null>(null);
	const [repairComputerId, setRepairComputerId] = useState<string | null>(null);
	useEffect(() => {
		if (!input.enabled) {
			setSetupTarget(null);
			setRepairComputerId(null);
		}
	}, [input.enabled]);
	const { target, selected, enrolled } = resolveRepairComputer(
		input,
		repairComputerId
	);
	const blocked =
		input.isPending ||
		input.guidance !== "set_up_local_agents" ||
		!input.hasLocalAgents;
	const state = resolveRecoveryState(input, target);
	const activeTarget =
		setupTarget ?? resolveAutomaticSetupTarget(blocked, state, target);
	const recovery: AgentCreationComputerRecovery | undefined =
		input.enabled && (blocked || setupTarget)
			? {
					state: activeTarget?.state ?? state,
					computerName: activeTarget ? activeTarget.name : target.name,
					onStart: input.onRetry,
					onBack: setupTarget ? () => setSetupTarget(null) : undefined,
					computerChoices:
						!(setupTarget || selected) && enrolled.length > 1 ? (
							<div className="grid gap-2">
								<label className="grid gap-2 text-sm">
									Computer to reconnect
									<select
										className="h-9 rounded-md border bg-background px-3"
										onChange={(event) =>
											setRepairComputerId(event.target.value || null)
										}
										value={repairComputerId ?? ""}
									>
										<option value="">Connect a new computer</option>
										{enrolled.map((computer) => (
											<option key={computer.deviceId} value={computer.deviceId}>
												{computer.deviceDisplayName}
											</option>
										))}
									</select>
								</label>
							</div>
						) : undefined,
					setup: activeTarget ? (
						<BringAgentsSetupProvider
							key={activeTarget.connectedComputerId ?? "new-computer"}
							routeIntent={{
								kind: "account_computer_setup",
								returnTo: "agent_creation",
								resetThisComputer: true,
								connectedComputerId: activeTarget.connectedComputerId,
							}}
						>
							<ComputerSetupFlow
								autoReturnOnCompletion={false}
								onCompleted={(snapshot) => {
									const lane = daemonServiceLaneSchema.safeParse(
										snapshot.runtimeLane
									);
									if (snapshot.deviceId && lane.success) {
										input.recovery.selectComputer({
											deviceId: snapshot.deviceId,
											runtimeLane: lane.data,
										});
									}
									input.onRetry();
									setSetupTarget(null);
								}}
								orgSlug={input.orgSlug}
								presentation="embedded"
								showBackControl={false}
							/>
						</BringAgentsSetupProvider>
					) : undefined,
				}
			: undefined;
	return {
		computerRecovery: recovery,
		connectAnotherComputer:
			input.enabled && !recovery ? (
				<Button
					className="justify-self-start"
					onClick={() => setSetupTarget({ state: "connect" })}
					size="sm"
					type="button"
					variant="ghost"
				>
					Connect another computer
				</Button>
			) : null,
	};
}

function resolveAutomaticSetupTarget(
	blocked: boolean,
	state: AgentCreationComputerRecovery["state"],
	target: SetupTarget
) {
	return blocked && state !== "checking" && state !== "check_failed"
		? { ...target, state }
		: null;
}

function resolveRepairComputer(
	input: RecoveryInput,
	repairComputerId: string | null
) {
	const computers =
		input.recovery.localRuntimesQuery.data?.peopleComputers.computers ?? [];
	const selected = computers.find((computer) =>
		input.sessionComputerId
			? computer.connectedComputerId === input.sessionComputerId
			: computer.deviceId === input.recovery.deviceId ||
				computer.legacyDeviceIds?.includes(input.recovery.deviceId ?? "")
	);
	const enrolled = computers.filter(
		(computer) => computer.identityStatus === "enrolled"
	);
	const repairComputer =
		selected ??
		enrolled.find((computer) => computer.deviceId === repairComputerId) ??
		(enrolled.length === 1 ? enrolled[0] : undefined);
	const target: SetupTarget = {
		connectedComputerId:
			repairComputer?.connectedComputerId ??
			(repairComputer?.identityStatus === "enrolled"
				? repairComputer.deviceId
				: input.sessionComputerId),
		name: repairComputer?.deviceDisplayName,
	};
	return { target, selected, enrolled };
}

function resolveRecoveryState(
	input: RecoveryInput,
	target: SetupTarget
): AgentCreationComputerRecovery["state"] {
	if (input.isPending || input.guidance === "checking") {
		return "checking";
	}
	if (input.guidance === "check_failed") {
		return "check_failed";
	}
	if (input.guidance === "set_up_local_agents") {
		return "local_agents";
	}
	return target.connectedComputerId ? "reconnect" : "connect";
}

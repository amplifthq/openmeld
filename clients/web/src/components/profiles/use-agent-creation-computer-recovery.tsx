"use client";

import { daemonServiceLaneSchema } from "@openmeld/schemas/schemas";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
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
	refreshReadiness?: () => Promise<unknown>;
};

export function useAgentCreationComputerRecovery(input: RecoveryInput) {
	const [repairComputerId, setRepairComputerId] = useState<string | null>(null);
	const [pendingSetup, setPendingSetup] = useState<SetupTarget | null>(null);
	const [setupCompleted, setSetupCompleted] = useState(false);
	useEffect(() => {
		if (!input.enabled) {
			setRepairComputerId(null);
			setPendingSetup(null);
			setSetupCompleted(false);
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
	const refreshInventory = input.recovery.localRuntimesQuery.refetch;
	const refreshReadiness =
		input.refreshReadiness ??
		input.recovery.currentLocalRuntimeReplyReadinessQuery.refetch;
	useEffect(() => {
		if (
			!input.enabled ||
			(input.hasLocalAgents && input.guidance === "set_up_local_agents") ||
			!(setupCompleted || input.guidance === "set_up_local_agents")
		) {
			return;
		}
		// Connection and catalog reports arrive separately. Reconcile both owning
		// projections until creation is ready, including after a transient read failure.
		let refreshing = false;
		const timer = window.setInterval(() => {
			if (refreshing) {
				return;
			}
			refreshing = true;
			Promise.all([refreshInventory(), refreshReadiness()])
				.catch((error: unknown) => {
					console.warn(
						"Could not refresh local agents after connecting.",
						error
					);
				})
				.finally(() => {
					refreshing = false;
				});
		}, 3000);
		return () => window.clearInterval(timer);
	}, [
		input.enabled,
		input.hasLocalAgents,
		input.guidance,
		refreshInventory,
		refreshReadiness,
		setupCompleted,
	]);
	const automaticTarget = resolveAutomaticSetupTarget(
		blocked && !setupCompleted,
		state,
		target
	);
	const setupId = automaticTarget?.connectedComputerId;
	const setupName = automaticTarget?.name;
	const setupState = automaticTarget?.state;
	useEffect(() => {
		if (input.enabled && setupState) {
			setPendingSetup({
				connectedComputerId: setupId,
				name: setupName,
				state: setupState,
			});
		}
	}, [input.enabled, setupId, setupName, setupState]);
	// Connection facts can arrive before Prepare's completion callback. Keep
	// that workflow mounted so it can select the runtime it actually connected.
	const activeTarget = automaticTarget ?? pendingSetup;
	const recovery: AgentCreationComputerRecovery | undefined =
		input.enabled && (blocked || activeTarget)
			? {
					state: activeTarget?.state ?? state,
					computerName: activeTarget ? activeTarget.name : target.name,
					onStart: () => {
						if (state === "connect" || state === "reconnect") {
							setSetupCompleted(false);
						}
						input.onRetry();
					},
					computerChoices:
						!(selected || setupCompleted) &&
						activeTarget &&
						enrolled.length > 0 ? (
							<div className="grid gap-2">
								<div className="grid gap-2 text-sm">
									Computer to reconnect
									<Select
										onValueChange={(value) =>
											setRepairComputerId(value || null)
										}
										value={repairComputerId ?? ""}
									>
										<SelectTrigger
											aria-label="Computer to reconnect"
											placeholder="Connect a new computer"
										/>
										<SelectContent>
											<SelectItem index={0} value="">
												Connect a new computer
											</SelectItem>
											{enrolled.map((computer, index) => (
												<SelectItem
													index={index + 1}
													key={computer.deviceId}
													value={computer.deviceId}
												>
													{computer.deviceDisplayName}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
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
									setPendingSetup(null);
									setSetupCompleted(true);
									input.onRetry();
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
		reconnectComputerId: target.connectedComputerId,
	};
}

function resolveAutomaticSetupTarget(
	blocked: boolean,
	state: AgentCreationComputerRecovery["state"],
	target: SetupTarget
) {
	return blocked && (state === "connect" || state === "reconnect")
		? { ...target, state }
		: null;
}

function resolveRepairComputer(
	input: RecoveryInput,
	repairComputerId: string | null
) {
	const computers =
		input.recovery.localRuntimesQuery.data?.peopleComputers.computers ?? [];
	// Catalog/routing selection (including recovery.deviceId) does not identify
	// the machine running Desktop. Only an explicit session/reconnect intent may
	// ask Prepare to attach this machine to an existing stable Computer.
	const selected = input.sessionComputerId
		? computers.find(
				(computer) => computer.connectedComputerId === input.sessionComputerId
			)
		: undefined;
	const enrolled = computers.filter(
		(computer) => computer.identityStatus === "enrolled"
	);
	const repairComputer =
		selected ??
		enrolled.find((computer) => computer.deviceId === repairComputerId);
	const target: SetupTarget = {
		connectedComputerId:
			repairComputer?.connectedComputerId ?? input.sessionComputerId,
		name: repairComputer?.deviceDisplayName,
	};
	return { target, selected, enrolled };
}

function resolveRecoveryState(
	input: RecoveryInput,
	target: SetupTarget
): AgentCreationComputerRecovery["state"] {
	if (
		input.isPending ||
		input.recovery.localRuntimesQuery.isPending ||
		input.guidance === "checking"
	) {
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

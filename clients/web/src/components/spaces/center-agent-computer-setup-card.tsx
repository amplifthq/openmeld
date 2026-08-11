"use client";

import type {
	NavigationAction,
	OpenMeldNavigationTarget,
} from "@openmeld/schemas";
import { getSetupFlowCopy } from "@openmeld/start";
import { Button } from "@openmeld/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { BringAgentsSetupProvider } from "#/components/connect/bring-agents-setup-context";
import { ComputerSetupConversationShell } from "#/components/connect/computer-setup-conversation-shell";
import { ComputerSetupFlow } from "#/components/connect/start-bring-agents-setup-page";
import type { ConnectRouteIntent } from "#/lib/connect/connect-route";

export type ComputerSetupTarget = Extract<
	OpenMeldNavigationTarget,
	{ kind: "computer_setup" }
>;

export type CenterAgentComputerSetupContext = {
	orgSlug: string;
	profileId: string;
	spaceId: string;
};

const STARTED_COMPUTER_SETUP_ACTIONS_STORAGE_KEY =
	"openmeld.center-agent.started-computer-setup-actions.v1";
const MAX_STORED_COMPUTER_SETUP_ACTIONS = 64;
const fallbackStartedComputerSetupActions = new Set<string>();

export function CenterAgentComputerSetupCard(input: {
	context: CenterAgentComputerSetupContext;
	sourceSignalId?: string;
	target: ComputerSetupTarget;
}) {
	const routeIntent = buildCenterAgentComputerSetupIntent(input);
	const actionKey = input.sourceSignalId
		? `${input.context.spaceId}:${input.sourceSignalId}`
		: null;
	const [flowState, setFlowState] = useState<
		"automatic" | "checking" | "open" | "paused"
	>(actionKey ? "checking" : "open");
	const resolvedActionKeyRef = useRef<string | null | undefined>(undefined);
	const mode =
		input.target.mode === "update_service" ? "update_service" : "setup";
	const setupCopy = getSetupFlowCopy(mode);

	useEffect(() => {
		if (resolvedActionKeyRef.current === actionKey) {
			return;
		}
		resolvedActionKeyRef.current = actionKey;
		if (!actionKey) {
			setFlowState("open");
			return;
		}
		if (hasStartedComputerSetupAction(actionKey)) {
			setFlowState("paused");
			return;
		}
		recordStartedComputerSetupAction(actionKey);
		setFlowState("automatic");
	}, [actionKey]);

	if (flowState !== "automatic" && flowState !== "open") {
		return (
			<ComputerSetupConversationShell
				description={
					flowState === "checking"
						? "Restoring this setup…"
						: "This setup is ready when you are. Continue to create a fresh Terminal command."
				}
				title={setupCopy.pageTitle}
			>
				{flowState === "paused" ? (
					<Button onClick={() => setFlowState("open")} type="button">
						{mode === "update_service" ? "Continue update" : "Continue setup"}
					</Button>
				) : null}
			</ComputerSetupConversationShell>
		);
	}

	return (
		<BringAgentsSetupProvider routeIntent={routeIntent}>
			<ComputerSetupFlow
				autoReturnOnCompletion={false}
				onNavigationActionAlreadyStarted={() => setFlowState("paused")}
				orgSlug={input.context.orgSlug}
				presentation="conversation"
				{...(flowState === "automatic" && input.sourceSignalId
					? {
							sourceNavigationAction: {
								signalId: input.sourceSignalId,
								spaceId: input.context.spaceId,
							},
						}
					: {})}
			/>
		</BringAgentsSetupProvider>
	);
}

function hasStartedComputerSetupAction(actionKey: string): boolean {
	if (typeof window === "undefined") {
		return fallbackStartedComputerSetupActions.has(actionKey);
	}
	try {
		const stored = JSON.parse(
			window.localStorage.getItem(STARTED_COMPUTER_SETUP_ACTIONS_STORAGE_KEY) ??
				"[]"
		);
		return Array.isArray(stored) && stored.some((value) => value === actionKey);
	} catch {
		return fallbackStartedComputerSetupActions.has(actionKey);
	}
}

function recordStartedComputerSetupAction(actionKey: string): void {
	fallbackStartedComputerSetupActions.add(actionKey);
	if (typeof window === "undefined") {
		return;
	}
	try {
		const stored = JSON.parse(
			window.localStorage.getItem(STARTED_COMPUTER_SETUP_ACTIONS_STORAGE_KEY) ??
				"[]"
		);
		const actionKeys = Array.isArray(stored)
			? stored.filter((value): value is string => typeof value === "string")
			: [];
		const nextActionKeys = [
			...actionKeys.filter((value) => value !== actionKey),
			actionKey,
		].slice(-MAX_STORED_COMPUTER_SETUP_ACTIONS);
		window.localStorage.setItem(
			STARTED_COMPUTER_SETUP_ACTIONS_STORAGE_KEY,
			JSON.stringify(nextActionKeys)
		);
	} catch {
		// The in-memory guard still prevents repeated side effects in this tab.
	}
}

export function buildCenterAgentComputerSetupIntent(input: {
	context: CenterAgentComputerSetupContext;
	target: ComputerSetupTarget;
}): ConnectRouteIntent {
	const target = input.target;

	return {
		agentProfileIds: [],
		...(target.mode === "setup"
			? {}
			: { connectedComputerId: target.connectedComputerId }),
		kind: "space_recovery",
		profileId: input.context.profileId,
		resetThisComputer: target.mode !== "setup",
		...(target.mode === "update_service"
			? { serviceAction: "update_service" as const }
			: {}),
		spaceId: input.context.spaceId,
	};
}

export function resolveLatestComputerSetupActionSignalId(input: {
	timelineItems: readonly {
		id: string;
		isAgentFinalReply?: boolean;
		navigationAction?: NavigationAction | null;
	}[];
}): string | null {
	for (let index = input.timelineItems.length - 1; index >= 0; index -= 1) {
		const item = input.timelineItems[index];
		if (
			item?.isAgentFinalReply === true &&
			item.navigationAction?.target.kind === "computer_setup"
		) {
			return item.id;
		}
	}
	return null;
}

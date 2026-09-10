"use client";

import { Button } from "@openmeld/ui/components/button";
import { DesktopTowerIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export type AgentCreationComputerRecovery = {
	state: "checking" | "check_failed" | "connect" | "reconnect" | "local_agents";
	computerName?: string;
	onStart: () => void;
	/** The existing setup workflow, mounted only after the user requests it. */
	setup?: ReactNode;
	onBack?: () => void;
	computerChoices?: ReactNode;
};

export function agentCreationComputerActionLabel(
	recovery: AgentCreationComputerRecovery
) {
	switch (recovery.state) {
		case "checking":
			return "Checking connection…";
		case "check_failed":
			return "Try again";
		case "reconnect":
			return "Reconnect Computer";
		case "local_agents":
			return "Set up local agents";
		default:
			return "Connect Computer";
	}
}

export function AgentCreationComputerRecoveryPanel(input: {
	recovery: AgentCreationComputerRecovery;
}) {
	const recovery = input.recovery;
	const copy = recoveryCopy(recovery);
	return (
		<section aria-label="Computer connection" className="grid gap-4 py-2">
			<div className="flex items-start gap-3">
				<DesktopTowerIcon
					aria-hidden="true"
					className="mt-0.5 size-5 shrink-0 text-muted-foreground"
				/>
				<div className="grid gap-2">
					<h2 aria-live="polite" className="font-medium text-base">
						{copy.title}
					</h2>
					<p className="max-w-xl text-muted-foreground text-sm leading-6">
						{copy.description}
					</p>
				</div>
			</div>
			{recovery.computerChoices}
			{recovery.setup ? (
				<div className="grid gap-3">
					<p className="text-muted-foreground text-sm">
						{recovery.computerName
							? `Run the command on ${recovery.computerName}. Keep this dialog open to continue with your Agent settings.`
							: "Run the command on the computer you want to use. Keep this dialog open to continue with your Agent settings."}
					</p>
					{recovery.setup}
					<Button
						className="justify-self-start"
						onClick={recovery.onBack}
						type="button"
						variant="ghost"
					>
						Back to Agent setup
					</Button>
				</div>
			) : null}
		</section>
	);
}

function recoveryCopy(recovery: AgentCreationComputerRecovery) {
	switch (recovery.state) {
		case "checking":
			return {
				title: "Checking the computer’s connection…",
				description:
					"Your Agent settings will stay here while OpenMeld checks the connection.",
			};
		case "check_failed":
			return {
				title: "Couldn’t check the computer’s connection",
				description:
					"Try checking again to continue. Your Agent settings are still here.",
			};
		case "reconnect":
			return {
				title: `${recovery.computerName ?? "This computer"} isn’t connected right now`,
				description:
					"This computer is already added to OpenMeld. Reconnect it to continue creating your Agent.",
			};
		case "local_agents":
			return {
				title: "Connect a local agent to continue",
				description:
					"Your computer is connected. Set up or enable a local agent, such as Codex or Claude Code, to use it here.",
			};
		default:
			return {
				title: "Connect a computer to continue",
				description:
					"Connect a computer to use its local agents, such as Codex or Claude Code. Then you can finish creating your Agent here.",
			};
	}
}

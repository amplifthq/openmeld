import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import {
	CompassIcon,
	DesktopTowerIcon,
	PlusCircleIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { useState } from "react";
import { LocalAgentLogoStack } from "#/components/profiles/local-agent-logo-stack";

type StarterActionIcon = ComponentType<{
	"aria-hidden"?: boolean | "true" | "false";
	className?: string;
	weight?: "regular" | "bold";
}>;

const CENTER_AGENT_STARTER_ACTIONS = [
	{
		description: "Bring your local agents into OpenMeld.",
		icon: DesktopTowerIcon as StarterActionIcon,
		id: "connect_my_computer",
		kind: "computer_setup",
		title: "Connect my computer",
	},
	{
		description:
			"Turn a goal into a Space with the right setup. Invite others and share it.",
		icon: PlusCircleIcon as StarterActionIcon,
		id: "create_space",
		kind: "prompt",
		prompt:
			"I want to create a Space. Ask me what I'm trying to accomplish, then help me set up the right Space, people, and agents.",
		title: "Create a Space",
	},
	{
		description: "Learn how OpenMeld works and what to do first.",
		icon: CompassIcon as StarterActionIcon,
		id: "show_me_around",
		kind: "prompt",
		prompt:
			"I'm new to OpenMeld. Give me a short, plain-English tour, then recommend the best first step for me.",
		title: "Show me around",
	},
] as const;

async function sendStarterPrompt(input: {
	onSelect: (prompt: string) => Promise<void>;
	prompt: string;
}): Promise<void> {
	try {
		await input.onSelect(input.prompt);
	} catch (error) {
		console.error("Failed to send a Center Agent starter prompt.", error);
	}
}

export function CenterAgentStarterActions(input: {
	disabled: boolean;
	showAgentLogos?: boolean;
	onConnectComputer: () => void;
	onSelect: (prompt: string) => Promise<void>;
}) {
	const [pendingActionId, setPendingActionId] = useState<string | null>(null);
	const actionPending = pendingActionId !== null;

	return (
		<FluidCardGroup
			aria-label="Suggested starting points"
			className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3"
			role="group"
		>
			{CENTER_AGENT_STARTER_ACTIONS.map((action) => {
				const Icon = action.icon;
				return (
					<FluidCardItem
						className="border border-border bg-transparent"
						itemId={action.id}
						key={action.id}
					>
						<button
							aria-busy={pendingActionId === action.id || undefined}
							className="flex h-full min-h-20 w-full items-start gap-3 rounded-md p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-32 sm:flex-col sm:justify-between sm:gap-5"
							disabled={input.disabled || actionPending}
							onClick={async () => {
								if (action.kind === "computer_setup") {
									input.onConnectComputer();
									return;
								}
								setPendingActionId(action.id);
								await sendStarterPrompt({
									onSelect: input.onSelect,
									prompt: action.prompt,
								});
								setPendingActionId(null);
							}}
							type="button"
						>
							<span className="text-muted-foreground">
								<Icon aria-hidden="true" className="size-4" />
							</span>
							<span className="min-w-0">
								<span className="block font-medium text-foreground text-sm leading-5">
									{action.title}
								</span>
								<span className="mt-0.5 block text-muted-foreground text-xs leading-5">
									{input.showAgentLogos && action.kind === "computer_setup" ? (
										<>
											<span className="sr-only">{action.description}</span>
											<span aria-hidden="true">
												Bring your <LocalAgentLogoStack /> into OpenMeld.
											</span>
										</>
									) : (
										action.description
									)}
								</span>
							</span>
						</button>
					</FluidCardItem>
				);
			})}
		</FluidCardGroup>
	);
}

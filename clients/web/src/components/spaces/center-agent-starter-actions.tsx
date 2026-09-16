import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import {
	CompassIcon,
	DesktopTowerIcon,
	PlusCircleIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
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

export function CenterAgentStarterActions(input: {
	disabled: boolean;
	showAgentLogos?: boolean;
	onConnectComputer: () => void;
	onSelect: (prompt: string) => void;
}) {
	return (
		<div className="@container/starter-actions w-full min-w-0">
			<FluidCardGroup
				aria-label="Suggested starting points"
				className="grid w-full @[36rem]/starter-actions:grid-cols-3 grid-cols-1 gap-3"
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
								className="flex h-full @[36rem]/starter-actions:min-h-32 min-h-20 w-full @[36rem]/starter-actions:flex-col items-start @[36rem]/starter-actions:justify-between @[36rem]/starter-actions:gap-5 gap-3 rounded-md p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
								disabled={input.disabled}
								onClick={() => {
									if (action.kind === "computer_setup") {
										input.onConnectComputer();
										return;
									}
									input.onSelect(action.prompt);
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
										{input.showAgentLogos &&
										action.kind === "computer_setup" ? (
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
		</div>
	);
}

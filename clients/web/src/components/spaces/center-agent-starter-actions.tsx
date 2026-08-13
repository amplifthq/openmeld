import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import {
	ArrowRightIcon,
	CompassIcon,
	DesktopTowerIcon,
	PlusCircleIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { useState } from "react";

type StarterActionIcon = ComponentType<{
	"aria-hidden"?: boolean | "true" | "false";
	className?: string;
	weight?: "regular" | "bold";
}>;

const CENTER_AGENT_STARTER_ACTIONS = [
	{
		description: "Learn how OpenMeld works and what to do first.",
		icon: CompassIcon as StarterActionIcon,
		id: "show_me_around",
		kind: "prompt",
		prompt:
			"I'm new to OpenMeld. Give me a short, plain-English tour, then recommend the best first step for me.",
		title: "Show me around",
	},
	{
		description: "Turn a goal into a Space with the right setup.",
		icon: PlusCircleIcon as StarterActionIcon,
		id: "start_something_new",
		kind: "prompt",
		prompt:
			"I want to start something new. Ask me what I'm trying to accomplish, then help me set up the right Space, people, and agents.",
		title: "Start something new",
	},
	{
		description:
			"Bring Codex, Claude Code, Grok Build, Cursor, OpenCode, or another local agent into OpenMeld.",
		icon: DesktopTowerIcon as StarterActionIcon,
		id: "connect_my_computer",
		kind: "computer_setup",
		title: "Connect my computer",
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
	onConnectComputer: () => void;
	onSelect: (prompt: string) => Promise<void>;
}) {
	const [pendingActionId, setPendingActionId] = useState<string | null>(null);
	const actionPending = pendingActionId !== null;

	return (
		<FluidActionList
			aria-label="Suggested starting points"
			className="w-full max-w-3xl overflow-hidden rounded-md border border-border"
			hoverIndicatorClassName="bg-muted/80"
		>
			{CENTER_AGENT_STARTER_ACTIONS.map((action, index) => {
				const Icon = action.icon;
				return (
					<FluidActionListItem
						aria-busy={pendingActionId === action.id || undefined}
						className="group flex min-h-16 w-full items-center gap-3 border-border border-b px-3 py-2.5 text-left last:border-b-0"
						disabled={input.disabled || actionPending}
						index={index}
						key={action.id}
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
					>
						<span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground transition-colors duration-100 group-data-[hovered]:text-foreground">
							<Icon aria-hidden="true" className="size-4" />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block font-medium text-foreground text-sm leading-5">
								{action.title}
							</span>
							<span className="mt-0.5 block text-muted-foreground text-xs leading-5">
								{action.description}
							</span>
						</span>
						<ArrowRightIcon
							aria-hidden="true"
							className="size-4 shrink-0 text-muted-foreground transition-[color,transform] duration-100 group-data-[hovered]:translate-x-0.5 group-data-[hovered]:text-foreground"
						/>
					</FluidActionListItem>
				);
			})}
		</FluidActionList>
	);
}

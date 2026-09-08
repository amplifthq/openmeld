import { Button } from "@openmeld/ui/components/button";
import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { RobotIcon } from "@phosphor-icons/react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { EmptyStateSetupActionCard } from "./onboarding-setup-banner";
import {
	resumeWelcomeSpace,
	saveWelcomeSpace,
	useWelcomeSpace,
} from "./welcome-space-state";

export function WelcomeSpaceLabel({ spaceId }: { spaceId: string }) {
	const { storageScope } = useAppOrganization();
	const step = useWelcomeSpace(storageScope, spaceId);
	return step ? (
		<span className="shrink-0 rounded border px-1.5 py-0.5 font-normal text-muted-foreground text-xs">
			Welcome
		</span>
	) : null;
}

export function WelcomeSpaceGuide(input: {
	scope: string;
	spaceId: string;
	onAddAgents?: () => void;
	onTryCenterAgent?: () => void;
}) {
	const step = useWelcomeSpace(input.scope, input.spaceId);
	if (!step || step === "prepare") {
		return null;
	}
	if (step === "done") {
		return (
			<p className="py-2 text-muted-foreground text-sm">
				Your first collaboration is complete. Keep working in this Space
				whenever you like.
			</p>
		);
	}
	if (step === "paused") {
		return (
			<div className="flex items-center justify-between gap-3 py-2 text-muted-foreground text-sm">
				<span>Welcome Space</span>
				<Button
					onClick={() => resumeWelcomeSpace(input.scope, input.spaceId)}
					size="sm"
					variant="outline"
				>
					Resume tutorial
				</Button>
			</div>
		);
	}
	return (
		<section
			aria-label="Welcome Space tutorial"
			className="mx-auto grid w-full max-w-xl gap-4 py-4"
		>
			<div className="flex items-start justify-between gap-4">
				<div className="grid gap-2">
					<h2 className="font-medium text-base">Try working with an agent</h2>
				</div>
				<Button
					onClick={() => saveWelcomeSpace(input.scope, input.spaceId, "paused")}
					size="sm"
					variant="outline"
				>
					Skip tutorial
				</Button>
			</div>
			{step === "add" && input.onAddAgents ? (
				<FluidCardGroup>
					<EmptyStateSetupActionCard
						description="Choose an agent or create your own. Then give it a task in this Space."
						icon={<RobotIcon className="size-5" />}
						itemId="welcome-add-agent"
						onClick={input.onAddAgents}
						title="Add your first agent"
					/>
				</FluidCardGroup>
			) : (
				<p className="text-muted-foreground text-sm">
					{input.onTryCenterAgent
						? "Write a task and mention an agent, or try a suggested task below."
						: "Review your message or write a task, mention an agent, then send it."}
				</p>
			)}
			{input.onTryCenterAgent && (
				<Button
					className="justify-self-center"
					onClick={input.onTryCenterAgent}
					variant={step === "add" ? "outline" : "default"}
				>
					Try a task with Center Agent
				</Button>
			)}
		</section>
	);
}

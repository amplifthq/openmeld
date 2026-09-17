import { getSetupFlowCopy } from "@openmeld/start";
import { Button } from "@openmeld/ui/components/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { ConnectRouteIntent } from "#/lib/connect/connect-route";
import { BringAgentsSetupProvider } from "./bring-agents-setup-context";
import { ComputerSetupFlow } from "./start-bring-agents-setup-page";

const AGENT_CREATION_SETUP_INTENT: ConnectRouteIntent = {
	kind: "account_computer_setup",
	returnTo: "agent_creation",
	resetThisComputer: true,
};

export function AgentCreationComputerSetup(input: {
	onBack: () => void;
	orgSlug: string;
}) {
	const copy = getSetupFlowCopy("setup");
	return (
		<>
			<Button
				className="w-fit self-start"
				onClick={input.onBack}
				size="sm"
				variant="ghost"
			>
				<ArrowLeftIcon aria-hidden="true" />
				Back to creating Agent
			</Button>
			<DialogHeader>
				<DialogTitle>{copy.pageTitle}</DialogTitle>
				<DialogDescription>{copy.pageDescription}</DialogDescription>
			</DialogHeader>
			<div className="min-h-0 overflow-y-auto">
				<BringAgentsSetupProvider routeIntent={AGENT_CREATION_SETUP_INTENT}>
					<ComputerSetupFlow
						autoReturnOnCompletion={false}
						onContinue={input.onBack}
						orgSlug={input.orgSlug}
						presentation="embedded"
						showBackControl={false}
					/>
				</BringAgentsSetupProvider>
			</div>
		</>
	);
}

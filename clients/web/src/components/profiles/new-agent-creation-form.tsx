"use client";

import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { CloudIcon, DesktopTowerIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";
import { CreateAgentProfilePage } from "./create-profile-dialog";
import { LocalAgentLogoStack } from "./local-agent-logo-stack";
import { RemoteAgentCreationForm } from "./remote-agent-creation-form";

type NewAgentCreationFormProps = {
	accountName: string | null;
	currentUserId: string;
	isPersonalOrganization: boolean;
	intentStorageScope: string;
	onAccepted: (
		request: AgentProfileCreationRequest,
		customWorkingFolderIssue?: string | null
	) => void;
	onCancel: () => void;
	onFailed: () => void;
	onStarted: (creation: OptimisticAgentProfileCreation) => void;
	organizationId: string;
	orgSlug: string;
};

export function NewAgentCreationForm(input: NewAgentCreationFormProps) {
	const [runtime, setRuntime] = useState<"local" | "remote">("local");
	const form =
		runtime === "remote" ? (
			<RemoteAgentCreationForm
				accountName={input.accountName}
				currentUserId={input.currentUserId}
				intentStorageScope={input.intentStorageScope}
				onAccepted={(request) => input.onAccepted(request)}
				onCancel={input.onCancel}
				onFailed={input.onFailed}
				onStarted={input.onStarted}
				organizationId={input.organizationId}
				requestedSpaceId={null}
			/>
		) : (
			<LocalAgentCreationForm {...input} />
		);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="mx-auto grid w-full max-w-7xl gap-5 px-4 pt-10 sm:px-6 lg:px-8">
				<div>
					<h1 className="font-medium text-2xl tracking-tight">Create Agent</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Choose where this Agent runs. A new chat opens after creation.
					</p>
				</div>
				<Tabs
					className="max-w-3xl"
					onValueChange={(value) =>
						setRuntime(value === "local" ? "local" : "remote")
					}
					value={runtime}
				>
					<TabsList
						aria-label="Agent runtime"
						background={false}
						className="grid grid-cols-2 items-stretch gap-2"
					>
						<TabItem
							aria-label="Choose a Local Agent"
							className="h-auto min-h-24 items-start gap-3 rounded-md border border-border border-dashed p-4 text-left aria-selected:border-transparent aria-selected:border-solid"
							label="Choose a Local Agent"
							value="local"
						>
							<DesktopTowerIcon
								aria-hidden="true"
								className="mt-0.5 size-5 shrink-0"
							/>
							<span className="grid gap-1">
								<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
									<span className="font-medium text-sm">
										Choose a Local Agent
									</span>
									<LocalAgentLogoStack compact />
								</span>
								<span className="text-muted-foreground text-xs">
									Runs on your computer.
								</span>
							</span>
						</TabItem>
						<TabItem
							aria-label="Remote Agent"
							className="h-auto min-h-24 items-start gap-3 rounded-md border border-border border-dashed p-4 text-left aria-selected:border-transparent aria-selected:border-solid"
							label="Remote Agent"
							value="remote"
						>
							<CloudIcon
								aria-hidden="true"
								className="mt-0.5 size-5 shrink-0"
							/>
							<span className="grid gap-1">
								<span className="font-medium text-sm">Remote Agent</span>
								<span className="text-muted-foreground text-xs">
									Runs in the cloud.
								</span>
							</span>
						</TabItem>
					</TabsList>
				</Tabs>
			</div>
			{form}
		</div>
	);
}

function LocalAgentCreationForm(input: NewAgentCreationFormProps) {
	const recovery = useLocalAgentRecoveryController({
		agentExecutionReadinessScope: "bound_runtime",
		loadAgentProfiles: false,
		loadSetupState: false,
	});
	return (
		<CreateAgentProfilePage
			allowTeammateRequests={!input.isPersonalOrganization}
			clearIntentOnAcceptance={false}
			compactTop
			currentUserId={input.currentUserId}
			hidePageHeading
			hideRuntimeSelection
			intentStorageScope={input.intentStorageScope}
			manageAgentCreationCachesExternally
			onAgentRequestCreated={input.onAccepted}
			onAgentRequestFailed={input.onFailed}
			onAgentRequestStarted={input.onStarted}
			onCancel={input.onCancel}
			organizationId={input.organizationId}
			orgSlug={input.orgSlug}
			recovery={recovery}
			waitForAgentRequestCompletion={false}
		/>
	);
}

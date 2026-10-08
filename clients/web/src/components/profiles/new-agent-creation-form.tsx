"use client";

import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { useState } from "react";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";
import { AgentRuntimeChoice } from "./agent-runtime-choice";
import { CreateAgentProfilePage } from "./create-profile-dialog";
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
				<AgentRuntimeChoice onChange={setRuntime} runtime={runtime} />
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

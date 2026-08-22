"use client";

import { Button } from "@openmeld/ui/components/button";
import { PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import type { SpaceJoinedProfileReference } from "#/lib/profiles/create-profile-orchestration";
import { CreateProfileDialog } from "./create-profile-dialog";

// Self-contained launcher for the Create Profile dialog from inside a Space.
// The dialog (and its lightweight recovery controller) only mounts once the
// user opens it, so a normal Space view pays nothing for it and never depends
// on StartFlow state until the user actually creates a profile. The dialog
// opens with a spaceContext so the new profile is joined to this Space on
// create. Callers only pass the Space id + name.
export function SpaceCreateProfileButton(input: {
	className?: string;
	label?: string;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	orgSlug: string;
	spaceId: string;
	spaceName: string | null;
}) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<Button
				className={input.className}
				onClick={() => {
					setIsOpen(true);
				}}
				size="xs"
				type="button"
				variant="outline"
			>
				<PlusIcon aria-hidden="true" data-icon="inline-start" />
				{input.label ?? "Create Agent"}
			</Button>
			{isOpen ? (
				<SpaceCreateProfileDialogMount
					onAfterJoin={input.onAfterJoin}
					onClose={() => {
						setIsOpen(false);
					}}
					orgSlug={input.orgSlug}
					spaceId={input.spaceId}
					spaceName={input.spaceName}
				/>
			) : null}
		</>
	);
}

function SpaceCreateProfileDialogMount(input: {
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	onClose: () => void;
	orgSlug: string;
	spaceId: string;
	spaceName: string | null;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const recovery = useLocalAgentRecoveryController({
		currentLocalRuntimeReplyReadinessRefetchIntervalMs: false,
		loadAgentExecutionReadiness: false,
		loadAgentProfiles: false,
		loadSetupState: false,
	});
	const organizationAuthorizationContext =
		currentOrganization.isPersonal === true
			? undefined
			: {
					organizationId: currentOrganization.id,
					organizationName: currentOrganization.name,
				};

	return (
		<CreateProfileDialog
			allowTeammateRequests={currentOrganization.isPersonal !== true}
			currentUserId={currentUserId}
			onAfterJoin={input.onAfterJoin}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					input.onClose();
				}
			}}
			open={true}
			organizationAuthorizationContext={organizationAuthorizationContext}
			organizationId={currentOrganization.id}
			orgSlug={input.orgSlug}
			recovery={recovery}
			spaceContext={{ spaceId: input.spaceId, spaceName: input.spaceName }}
		/>
	);
}

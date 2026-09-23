"use client";

import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { CloudIcon, DesktopTowerIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { selectAccountSpaceSections } from "#/components/spaces/account-space-sections";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";
import { resolveAppSpacesProfileId } from "#/lib/spaces/app-spaces-profile";
import { organizationSpacesQueryOptions } from "#/query/organizations/organization-directory";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { CreateAgentProfilePage } from "./create-profile-dialog";
import { RemoteAgentCreationForm } from "./remote-agent-creation-form";

type CreationDestination = "chat" | "space";

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
	const [runtime, setRuntime] = useState<"local" | "remote" | null>(null);
	const [destination, setDestination] = useState<CreationDestination>("chat");
	const [selectedSpaceId, setSelectedSpaceId] = useState("");
	const spaces = useSpaceChoices({
		enabled: destination === "space",
		organizationId: input.organizationId,
	});
	const selectedSpace =
		destination === "space"
			? spaces.joined.find((space) => space.spaceId === selectedSpaceId)
			: undefined;
	let form: ReactNode = null;
	if (runtime && (destination === "chat" || selectedSpace)) {
		form =
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
					requestedSpaceId={selectedSpace?.spaceId ?? null}
				/>
			) : (
				<LocalAgentCreationForm
					{...input}
					space={
						selectedSpace
							? {
									spaceId: selectedSpace.spaceId,
									spaceName: selectedSpace.name,
								}
							: null
					}
				/>
			);
	}
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="mx-auto grid w-full max-w-7xl gap-5 px-4 pt-10 sm:px-6 lg:px-8">
				<div>
					<h1 className="font-medium text-2xl tracking-tight">Create Agent</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						Choose where this Agent runs and what you want to do next.
					</p>
				</div>
				<fieldset className="flex flex-wrap gap-2">
					<legend className="sr-only">Agent runtime</legend>
					<Button
						aria-pressed={runtime === "local"}
						onClick={() => setRuntime("local")}
						type="button"
						variant={runtime === "local" ? "secondary" : "outline"}
					>
						<DesktopTowerIcon aria-hidden="true" /> Local Agent
					</Button>
					<Button
						aria-pressed={runtime === "remote"}
						onClick={() => setRuntime("remote")}
						type="button"
						variant={runtime === "remote" ? "secondary" : "outline"}
					>
						<CloudIcon aria-hidden="true" /> Remote Agent
					</Button>
				</fieldset>
				<div className="grid max-w-xl gap-2">
					<fieldset className="flex flex-wrap gap-2">
						<legend className="mb-2 font-medium text-sm">After creation</legend>
						<Button
							aria-pressed={destination === "chat"}
							onClick={() => setDestination("chat")}
							type="button"
							variant={destination === "chat" ? "secondary" : "outline"}
						>
							Start a chat
						</Button>
						<Button
							aria-pressed={destination === "space"}
							onClick={() => setDestination("space")}
							type="button"
							variant={destination === "space" ? "secondary" : "outline"}
						>
							Add to a Space
						</Button>
					</fieldset>
					{destination === "space" && (
						<SpaceDestinationPicker
							onChange={setSelectedSpaceId}
							selectedSpaceId={selectedSpaceId}
							spaces={spaces}
						/>
					)}
				</div>
			</div>
			{form ?? (
				<p className="mx-auto w-full max-w-7xl px-4 pt-4 text-muted-foreground text-sm sm:px-6 lg:px-8">
					{runtime
						? "Choose a Space to continue."
						: "Choose where your Agent runs to continue."}
				</p>
			)}
		</div>
	);
}

function useSpaceChoices(input: { enabled: boolean; organizationId: string }) {
	const { state, storageScope } = useStartFlowState();
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: input.enabled,
			storageScope,
		})
	);
	const profileId = resolveAppSpacesProfileId({
		profiles: profilesQuery.data ?? [],
		selectedHumanProfileId: state.selectedHumanProfileId,
	});
	const accountSpacesQuery = useQuery({
		...accountSpaceItemsQueryOptions({
			enabled: input.enabled && profileId !== null,
			profileId: profileId ?? "",
		}),
		// A destination picker needs a snapshot, not the Spaces sidebar's
		// five-second invitation polling loop.
		refetchInterval: false,
		refetchOnWindowFocus: false,
	});
	const spacesQuery = useQuery(
		organizationSpacesQueryOptions({
			enabled: input.enabled,
			organizationId: input.organizationId,
		})
	);
	const regularSections = accountSpacesQuery.data
		? selectAccountSpaceSections({
				currentOrganizationId: input.organizationId,
				sections: accountSpacesQuery.data,
			})
		: null;
	const regularSpaceIds = new Set(
		[
			...(regularSections?.pinnedItems ?? []),
			...(regularSections?.spaceItems ?? []),
		].map((space) => space.spaceId)
	);
	const joined =
		spacesQuery.data?.spaces.filter(
			(space) => space.joined && regularSpaceIds.has(space.spaceId)
		) ?? [];
	const pending =
		spacesQuery.isPending ||
		profilesQuery.isPending ||
		accountSpacesQuery.isPending;
	const failed =
		spacesQuery.isError || profilesQuery.isError || accountSpacesQuery.isError;
	const retry = () => {
		for (const query of [spacesQuery, profilesQuery, accountSpacesQuery]) {
			if (query.isError) {
				query.refetch().catch(console.error);
			}
		}
	};
	return { joined, pending, failed, retry };
}

function SpaceDestinationPicker(input: {
	onChange: (spaceId: string) => void;
	selectedSpaceId: string;
	spaces: ReturnType<typeof useSpaceChoices>;
}) {
	const selectedSpace = input.spaces.joined.find(
		(space) => space.spaceId === input.selectedSpaceId
	);
	return (
		<>
			<Select onValueChange={input.onChange} value={input.selectedSpaceId}>
				<SelectTrigger
					aria-label="Space"
					displayValue={selectedSpace?.name}
					placeholder={
						input.spaces.pending ? "Loading Spaces…" : "Choose a Space"
					}
				/>
				<SelectContent>
					{input.spaces.joined.map((space, index) => (
						<SelectItem index={index} key={space.spaceId} value={space.spaceId}>
							{space.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{input.spaces.failed && (
				<div
					className="flex items-center gap-2 text-destructive text-sm"
					role="alert"
				>
					Couldn’t load Spaces.
					<Button
						onClick={input.spaces.retry}
						size="sm"
						type="button"
						variant="link"
					>
						Try again
					</Button>
				</div>
			)}
			{!(input.spaces.pending || input.spaces.failed) &&
				input.spaces.joined.length === 0 && (
					<p className="text-muted-foreground text-sm">
						You’re not in a Space you can add an Agent to yet.
					</p>
				)}
		</>
	);
}

function LocalAgentCreationForm(
	input: NewAgentCreationFormProps & {
		space: { spaceId: string; spaceName: string } | null;
	}
) {
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
			spaceContext={input.space ?? undefined}
			waitForAgentRequestCompletion={false}
		/>
	);
}

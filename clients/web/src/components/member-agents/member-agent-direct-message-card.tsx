import { resolveMemberAgentWelcomePermissionModeLine } from "@openmeld/agent-runtime";
import type { PublicWakeabilityReason } from "@openmeld/schemas";
import type {
	ModelCatalog,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CheckCircleIcon,
	CircleNotchIcon,
	WarningCircleIcon,
	WifiSlashIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "#/components/spaces/primitives/message";
import { SpaceAgentIssueRecoveryAction } from "#/components/spaces/space-agent-recovery-context";
import { resolveSpaceMessageRowLayoutClassName } from "#/components/spaces/space-message-bubble-style";
import { SpaceMessageProfileAvatar } from "#/components/spaces/space-message-profile-avatar";
import { SpaceMessageTime } from "#/components/spaces/space-message-time";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { resolveAgentProfileModel } from "#/lib/profiles/agent-profile-model-display";
import { organizationAgentRuntimeOverviewQueryOptions } from "#/query/organizations/organization-directory";
import {
	type DirectMessageMemberAgent,
	resolveDirectMessageMemberAgent,
} from "./member-agent-chat-history";
import { useMemberAgentIndex } from "./use-member-agents";

export type MemberAgentDirectMessageCardModel =
	| {
			kind: "welcome";
			title: string;
			details: readonly { label: string; value: string }[];
			note: string | null;
	  }
	| {
			kind: "checking" | "offline" | "repair";
			title: string;
			description: string;
			/** Overrides the recovery plan's own action label. */
			actionLabel?: string;
	  };

/**
 * One presentation card per problem for a MemberAgent Direct Message,
 * updated in place; never a published message. Driven by the Profile's four
 * Wakeability states and, when Core has exact evidence, its public
 * Wakeability reason. The card is shown as posted by the Agent, so titles
 * name the state, not the Agent.
 */
export function resolveMemberAgentDirectMessageCard(input: {
	entry: SpaceMemberDirectoryEntry;
	modelCatalog: ModelCatalog | null;
	reason?: PublicWakeabilityReason | null;
	/** Whether this Session already has messages. */
	hasMessages?: boolean;
}): MemberAgentDirectMessageCardModel {
	const { entry } = input;
	// A missing folder is set-up work, not a failure: before the first task
	// nothing has failed yet.
	if (
		entry.availabilityReasonCode !== null &&
		WORKING_FOLDER_MISSING_REASON_CODES.has(entry.availabilityReasonCode)
	) {
		return {
			kind: "repair",
			title: "Working folder missing",
			description: input.hasMessages
				? "Choose a working folder before the next task."
				: "Choose a working folder before the first task.",
			actionLabel: "Choose working folder",
		};
	}
	if (input.reason && entry.availabilityCategory !== "available") {
		return resolveReasonCard(input.reason);
	}
	switch (entry.availabilityCategory) {
		case "available": {
			const model = resolveAgentProfileModel({
				agentControllerRef: entry.agentControllerRef,
				modelCatalog: input.modelCatalog,
				modelSelection: entry.modelSelection,
			});
			const details = [
				{
					label: "Computer",
					value: entry.runtimeDeviceDisplayName ?? "Your computer",
				},
				{
					label: "Default model",
					value:
						model.catalogModel?.displayName ??
						model.modelId ??
						"The harness default",
				},
				...(entry.workingDirectory
					? [{ label: "Default folder", value: entry.workingDirectory }]
					: []),
			];
			return {
				kind: "welcome",
				title: "Ready to work",
				details,
				note: resolvePermissionModeNote(entry),
			};
		}
		case "offline":
			return {
				kind: "offline",
				title: entry.availabilityBadgeLabel ?? "Offline",
				description:
					entry.availabilitySummary ??
					"Its computer isn’t connected. Messages wait until it’s back.",
			};
		case "unavailable":
			// Harness missing, setup failed, and the other readiness reasons
			// carry their own shared public copy on the directory entry.
			return {
				kind: "repair",
				title: entry.availabilityBadgeLabel ?? "Needs attention",
				description:
					entry.availabilitySummary ??
					"This Agent can’t start work right now. Open its settings to fix it.",
			};
		default:
			return {
				kind: "checking",
				title: "Checking availability",
				description: "OpenMeld is checking whether this Agent can start work.",
			};
	}
}

function resolvePermissionModeNote(
	entry: SpaceMemberDirectoryEntry
): string | null {
	return resolveMemberAgentWelcomePermissionModeLine({
		agentControllerPermissionMode: entry.agentControllerPermissionMode,
		agentControllerRef: entry.agentControllerRef,
	});
}

function resolveReasonCard(
	reason: PublicWakeabilityReason
): MemberAgentDirectMessageCardModel {
	switch (reason.code) {
		case "computer_offline":
			return {
				kind: "offline",
				title: "Offline",
				description:
					"Its computer isn’t connected. Messages wait until it’s back.",
			};
		case "not_signed_in":
			return {
				kind: "repair",
				title: "Not signed in",
				description:
					"The harness isn’t signed in on its computer. Sign in there, then send your message again.",
			};
		case "no_subscription":
			return {
				kind: "repair",
				title: "No active plan",
				description:
					"The harness account on its computer has no active subscription. Renew it, then try again.",
			};
		case "org_disabled":
			return {
				kind: "repair",
				title: "Turned off here",
				description:
					"This harness is turned off for its account’s organization. Ask that account’s admin to turn it on.",
			};
		case "version_too_old":
			return {
				kind: "repair",
				title: "Update needed",
				description: `The installed harness can’t run ${reason.modelId}. Update it on its computer, or choose another model.`,
			};
		case "usage_exhausted":
			return {
				kind: "repair",
				title: "Usage limit reached",
				description: reason.resetAt
					? `It can work again after ${new Date(reason.resetAt).toLocaleString(
							"en-US",
							{ dateStyle: "medium", timeStyle: "short" }
						)}.`
					: "It can work again when the limit resets.",
			};
		default:
			return {
				kind: "repair",
				title: "Needs attention",
				description: "This Agent can’t start work right now.",
			};
	}
}

const WORKING_FOLDER_MISSING_REASON_CODES: ReadonlySet<string> = new Set([
	"workspace.missing",
	"profile.workspace.missing",
]);

const CARD_ICON = {
	checking: CircleNotchIcon,
	offline: WifiSlashIcon,
	repair: WarningCircleIcon,
	welcome: CheckCircleIcon,
} as const;

/**
 * The card as a message row posted by the Agent: its avatar, name, and the
 * time this view first showed the state, with the card as the body. The time
 * is presentation only; nothing is published.
 */
export function MemberAgentDirectMessageCard(input: {
	current: DirectMessageMemberAgent;
	entry: SpaceMemberDirectoryEntry;
	model: MemberAgentDirectMessageCardModel;
}) {
	const [shownAtMs] = useState(() => Date.now());
	const Icon = CARD_ICON[input.model.kind];
	const name = input.current.memberAgent.displayName;
	return (
		<Message
			className={cn(
				resolveSpaceMessageRowLayoutClassName({
					isFirstInGroup: true,
					isLastInGroup: true,
				}),
				"px-0"
			)}
			data-member-agent-card={input.model.kind}
		>
			<MessageContent className="w-full min-w-0 gap-1.5">
				<MessageHeader className="items-center gap-1.5 px-0">
					<SpaceMessageProfileAvatar
						agentControllerRef={input.entry.agentControllerRef}
						avatarImageUrl={input.entry.avatarUrl}
						avatarModelId={input.entry.avatarModelId}
						avatarStyle={input.entry.avatarStyle}
						displayName={name}
						profileId={input.entry.profileId}
						profileKind="agent"
						responsive
					/>
					<span className="min-w-0 truncate">{name}</span>
					<SpaceMessageTime
						createdAtMs={shownAtMs}
						isDirectMessage={false}
						placement="header"
					/>
				</MessageHeader>
				<section
					aria-label={input.model.title}
					className="w-full max-w-xl rounded-lg border bg-card px-4 py-3 text-sm"
				>
					<h2 className="flex min-w-0 items-center gap-2 font-medium">
						<Icon
							aria-hidden="true"
							className={
								input.model.kind === "repair"
									? "size-4 shrink-0 text-destructive"
									: "size-4 shrink-0 text-muted-foreground"
							}
						/>
						<span className="truncate">{input.model.title}</span>
					</h2>
					{input.model.kind === "welcome" ? (
						<>
							<dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
								{input.model.details.map((detail) => (
									<div className="contents" key={detail.label}>
										<dt className="text-muted-foreground">{detail.label}</dt>
										<dd className="min-w-0 truncate">{detail.value}</dd>
									</div>
								))}
							</dl>
							{input.model.note ? (
								<p className="mt-3 text-muted-foreground text-xs">
									{input.model.note}
								</p>
							) : null}
						</>
					) : (
						<>
							<p className="mt-1 text-muted-foreground">
								{input.model.description}
							</p>
							{input.model.kind === "checking" ? null : (
								<div className="mt-3 flex flex-col items-start gap-2 empty:hidden">
									<SpaceAgentIssueRecoveryAction
										actionLabel={input.model.actionLabel}
										className="mt-0"
										profileId={input.entry.profileId}
									/>
								</div>
							)}
						</>
					)}
				</section>
			</MessageContent>
		</Message>
	);
}

export type MemberAgentDirectMessageCardState = {
	current: DirectMessageMemberAgent;
	entry: SpaceMemberDirectoryEntry;
	model: MemberAgentDirectMessageCardModel;
};

/** Whether the card reports a problem, so it owns that problem's fix. */
export function isMemberAgentIssueCard(
	card: MemberAgentDirectMessageCardState | null
): boolean {
	return card?.model.kind === "repair" || card?.model.kind === "offline";
}

/**
 * The card for the signed-in member's current MemberAgent Direct Message, or
 * null. Callers render nothing (and keep their own empty-state guidance)
 * when this is null.
 */
type MemberAgentDirectMessageCardInput = {
	isDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	readOnly?: boolean;
	hasMessages: boolean;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
};

/**
 * The card for the signed-in member's current MemberAgent Direct Message, or
 * null. Chosen once from MEMBER_AGENTS_ENABLED: with the flag off it reads
 * nothing.
 */
export const useMemberAgentDirectMessageCard: (
	input: MemberAgentDirectMessageCardInput
) => MemberAgentDirectMessageCardState | null = isMemberAgentsEnabled()
	? useEnabledMemberAgentDirectMessageCard
	: () => null;

function useEnabledMemberAgentDirectMessageCard(input: {
	isDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	/** Observers (for example an Agent owner watching) get no card. */
	readOnly?: boolean;
	hasMessages: boolean;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
}): MemberAgentDirectMessageCardState | null {
	const memberAgents = useMemberAgentIndex();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	// The public Wakeability reason rides on the owner's runtime overview.
	const runtime = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: memberAgents.ready && input.isDirectMessage,
			organizationId,
		})
	);
	if (!memberAgents.ready || input.readOnly === true) {
		return null;
	}
	const current = resolveDirectMessageMemberAgent({
		index: memberAgents.index,
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		isDirectMessage: input.isDirectMessage,
		snapshot: input.membersSnapshot,
	});
	const entry = current
		? input.profileEntriesById.get(current.agentProfileId)
		: undefined;
	if (!(current && entry)) {
		return null;
	}
	const model = resolveMemberAgentDirectMessageCard({
		entry,
		modelCatalog: input.modelCatalog,
		hasMessages: input.hasMessages,
		reason:
			runtime.data?.agentProfiles.find(
				(item) => item.profileId === current.agentProfileId
			)?.readiness.publicWakeabilityReason ?? null,
	});
	// The welcome card belongs to an empty Session; repair cards stay.
	return model.kind === "welcome" && input.hasMessages
		? null
		: { current, entry, model };
}

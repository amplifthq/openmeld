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
import {
	isWorkingFolderInvalidReasonCode,
	isWorkingFolderMissingReasonCode,
} from "#/components/spaces/space-agent-recovery-action";
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
			kind: "offline" | "repair";
			title: string;
			description: string;
	  };

/**
 * One presentation card per problem for a MemberAgent Direct Message,
 * updated in place; never a published message. Driven by the Profile's four
 * Wakeability states and, when Core has exact evidence, its public
 * Wakeability reason. The card is shown as posted by the Agent, so titles
 * name the state, not the Agent. Checking or unknown readiness is not news
 * for the member: it gets no card (null); the members panel shows it.
 */
export function resolveMemberAgentDirectMessageCard(input: {
	entry: SpaceMemberDirectoryEntry;
	modelCatalog: ModelCatalog | null;
	reason?: PublicWakeabilityReason | null;
	/** Whether this Session already has messages. */
	hasMessages?: boolean;
}): MemberAgentDirectMessageCardModel | null {
	const { entry } = input;
	// A missing folder is set-up work, not a failure: before the first task
	// nothing has failed yet.
	if (isWorkingFolderMissingReasonCode(entry.availabilityReasonCode)) {
		return {
			kind: "repair",
			title: "Working folder missing",
			description: input.hasMessages
				? "Choose a working folder before the next task."
				: "Choose a working folder before the first task.",
		};
	}
	// The folder was set up, then moved, deleted or made unreadable.
	if (isWorkingFolderInvalidReasonCode(entry.availabilityReasonCode)) {
		return {
			kind: "repair",
			title: entry.availabilityBadgeLabel ?? "Working folder unavailable",
			description:
				"This Agent can’t use its working folder. It may have been moved or deleted.",
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
			return null;
	}
}

/**
 * What the card shows across readiness reads for one Agent's Direct Message.
 * A read that is checking or refreshing keeps the last settled card, so a
 * background refresh never makes the card flash. The welcome is for an Agent
 * that was ready when the member arrived; it is not posted later just because
 * a check finished.
 */
export type SettledDirectMessageCard = {
	key: string | null;
	model: MemberAgentDirectMessageCardModel | null;
	/** A check came before the first settled state. */
	settledAfterCheck: boolean;
};

export function nextSettledDirectMessageCard(
	previous: SettledDirectMessageCard | null,
	read: {
		key: string | null;
		/** Null while readiness is checking, unknown, or refreshing. */
		model: MemberAgentDirectMessageCardModel | null;
	}
): SettledDirectMessageCard {
	// No Direct Message Agent known yet (still loading): nothing to change.
	if (previous && read.key === null) {
		return previous;
	}
	if (previous?.key !== read.key) {
		return {
			key: read.key,
			model: read.model,
			settledAfterCheck: read.model === null,
		};
	}
	if (read.model === null) {
		return previous;
	}
	return { ...previous, model: read.model };
}

/** The card to render, or null; "Ready to work" only for an empty Session. */
export function visibleDirectMessageCardModel(
	settled: SettledDirectMessageCard,
	hasMessages: boolean
): MemberAgentDirectMessageCardModel | null {
	if (
		settled.model?.kind === "welcome" &&
		(hasMessages || settled.settledAfterCheck)
	) {
		return null;
	}
	return settled.model;
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
		case "harness_turned_off":
			return {
				kind: "repair",
				title: "Turned off",
				description: "This harness is turned off on its computer.",
			};
		case "no_working_folder":
			return {
				kind: "repair",
				title: "No working folder",
				description: "This Agent has no working folder on its computer.",
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

const CARD_ICON = {
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
							<div className="mt-3 flex flex-col items-start gap-2 empty:hidden">
								<SpaceAgentIssueRecoveryAction
									className="mt-0"
									profileId={input.entry.profileId}
								/>
							</div>
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
	const current =
		memberAgents.ready && input.readOnly !== true
			? resolveDirectMessageMemberAgent({
					index: memberAgents.index,
					isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
					isDirectMessage: input.isDirectMessage,
					snapshot: input.membersSnapshot,
				})
			: null;
	const entry = current
		? input.profileEntriesById.get(current.agentProfileId)
		: undefined;
	const model =
		current && entry && !entry.availabilityIsRefreshing
			? resolveMemberAgentDirectMessageCard({
					entry,
					modelCatalog: input.modelCatalog,
					hasMessages: input.hasMessages,
					reason:
						runtime.data?.agentProfiles.find(
							(item) => item.profileId === current.agentProfileId
						)?.readiness.publicWakeabilityReason ?? null,
				})
			: null;
	const read = { key: current?.agentProfileId ?? null, model };
	const [settled, setSettled] = useState<SettledDirectMessageCard>(() =>
		nextSettledDirectMessageCard(null, read)
	);
	const next = nextSettledDirectMessageCard(settled, read);
	if (
		next.key !== settled.key ||
		next.settledAfterCheck !== settled.settledAfterCheck ||
		JSON.stringify(next.model) !== JSON.stringify(settled.model)
	) {
		setSettled(next);
	}
	const visible = visibleDirectMessageCardModel(next, input.hasMessages);
	return current && entry && visible
		? { current, entry, model: visible }
		: null;
}

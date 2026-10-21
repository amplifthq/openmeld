import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import {
	buildSpaceAgentAccessSearch,
	SPACE_AGENT_ACCESS_SECTION,
} from "#/lib/spaces/space-members-focus";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import type {
	AgentAccessEntry,
	AgentAccessEntrySpace,
} from "./agent-access-entries";
import { AgentAccessList } from "./agent-access-list";
import {
	useAgentProfileAccessEntries,
	useSpaceAgentAccessEntries,
} from "./use-agent-access-entries";

export const SPACE_AGENT_ACCESS_SECTION_ID = "space-agent-access";

/**
 * The Space Members panel's Agent access section: where access is managed.
 * Hidden when it has no rows.
 */
export function SpaceAgentAccessSection(input: {
	spaceId: string | undefined;
	isDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
	centerAgentProfileId: string | null;
	highlightId?: string | null;
	onAskAgainInDirectMessage?: () => void;
}) {
	if (!isMemberAgentsEnabled()) {
		return null;
	}
	return <SpaceAgentAccessSectionContent {...input} />;
}

function SpaceAgentAccessSectionContent(input: {
	spaceId: string | undefined;
	isDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
	centerAgentProfileId: string | null;
	highlightId?: string | null;
	onAskAgainInDirectMessage?: () => void;
}) {
	const state = useSpaceAgentAccessEntries(input);
	if (state.entries.length === 0) {
		return null;
	}
	const mixesAgents =
		new Set(state.entries.map((entry) => entry.agent.profileId)).size > 1;
	return (
		<section
			aria-labelledby={`${SPACE_AGENT_ACCESS_SECTION_ID}-heading`}
			className="grid gap-1 border-border border-t pt-3"
			data-section={SPACE_AGENT_ACCESS_SECTION}
			id={SPACE_AGENT_ACCESS_SECTION_ID}
		>
			<h3
				className="px-2 font-medium text-muted-foreground text-xs"
				id={`${SPACE_AGENT_ACCESS_SECTION_ID}-heading`}
			>
				Agent access
			</h3>
			<AgentAccessList
				actions={state.actions}
				aria-label="Agent access"
				avatars={state.avatars}
				entries={state.entries}
				error={state.error}
				highlightId={input.highlightId ?? null}
				mixesAgents={mixesAgents}
			/>
		</section>
	);
}

function spaceLinkPath(input: {
	orgSlug: string;
	space: AgentAccessEntrySpace;
	highlight?: string;
}): string {
	const search = buildSpaceAgentAccessSearch(input.highlight);
	return input.space.kind === "direct_message"
		? buildOrganizationDirectMessagePath({
				orgSlug: input.orgSlug,
				spaceId: input.space.spaceId,
				search,
			})
		: buildOrganizationSpacePath({
				orgSlug: input.orgSlug,
				spaceId: input.space.spaceId,
				search,
			});
}

const CHIP_CLASS_NAME =
	"inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function SpaceChips(input: {
	entry: AgentAccessEntry;
	label: (space: AgentAccessEntrySpace) => string;
	orgSlug: string;
	/** Name the row in the link so the Space highlights it. */
	highlight: boolean;
}) {
	if (input.entry.spaces.length === 0 || !input.orgSlug) {
		return null;
	}
	return (
		<ul className="flex flex-wrap gap-1.5">
			{input.entry.spaces.map((space) => (
				<li className="min-w-0 max-w-full" key={space.spaceId}>
					<Link
						className={CHIP_CLASS_NAME}
						to={spaceLinkPath({
							orgSlug: input.orgSlug,
							space,
							highlight: input.highlight ? input.entry.id : undefined,
						})}
					>
						<span className="truncate">{input.label(space)}</span>
						<ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
					</Link>
				</li>
			))}
		</ul>
	);
}

/**
 * The Agent page's Access section: the same rows as the Space, read-only,
 * each linking to the Space where it is managed. `children` is the owner's
 * change log, collapsed below the rows.
 */
export function AgentProfileAccessOverview(input: {
	profileId: string;
	profileName: string;
	ownerUserId: string | null | undefined;
	isOwner: boolean;
	children?: ReactNode;
}) {
	if (!(isMemberAgentsEnabled() && (input.isOwner || input.ownerUserId))) {
		return null;
	}
	return <AgentProfileAccessOverviewContent {...input} />;
}

function AgentProfileAccessOverviewContent(input: {
	profileId: string;
	profileName: string;
	ownerUserId: string | null | undefined;
	isOwner: boolean;
	children?: ReactNode;
}) {
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const orgSlug = organization?.slug ?? "";
	const state = useAgentProfileAccessEntries(input);
	const sessions = useQuery(
		agentDirectMessageSessionsQueryOptions({
			organizationId: organization?.id ?? "",
			agentProfileId: input.profileId,
			enabled: !input.isOwner && Boolean(organization?.id),
		})
	);
	const sessionNames = new Map(
		(sessions.data?.sessions ?? []).map((session) => [
			session.spaceId,
			session.name,
		])
	);
	if (!input.isOwner && state.entries.length === 0 && !state.isPending) {
		return null;
	}
	const heading = input.isOwner ? "Access" : "Your access";
	let content: ReactNode;
	if (state.isPending) {
		content = <SkeletonRows label="Loading access" rows={2} />;
	} else if (state.entries.length === 0) {
		content = (
			<p className="text-muted-foreground text-xs">
				No colleagues have access yet. They can ask to use this Agent from a
				chat.
			</p>
		);
	} else {
		content = (
			<AgentAccessList
				aria-label={heading}
				avatars={state.avatars}
				entries={state.entries}
				readOnly
				renderFooter={(entry) => (
					<SpaceChips
						entry={entry}
						highlight
						label={(space) =>
							input.isOwner
								? `Manage in ${ownerChatName(entry, space, state.spaceNames)}`
								: (sessionNames.get(space.spaceId) ??
									state.spaceNames.get(space.spaceId) ??
									"Open chat")
						}
						orgSlug={orgSlug}
					/>
				)}
			/>
		);
	}
	return (
		<section
			aria-labelledby="agent-access-heading"
			className="grid max-w-3xl gap-2"
		>
			<h2 className="font-medium text-sm" id="agent-access-heading">
				{heading}
			</h2>
			{content}
			{input.isOwner && input.children ? (
				<Accordion>
					<AccordionItem value="recent-changes">
						<AccordionTrigger className="py-1">
							<span className="block text-muted-foreground text-xs">
								Recent changes
							</span>
						</AccordionTrigger>
						{/* The log's own heading would repeat the trigger. */}
						<AccordionContent className="[&_#sensitive-operation-audit-heading]:sr-only">
							{input.children}
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			) : null}
		</section>
	);
}

/** The owner observes a colleague's chats, so they are named for the colleague. */
function ownerChatName(
	entry: AgentAccessEntry,
	space: AgentAccessEntrySpace,
	spaceNames: ReadonlyMap<string, string>
): string {
	const person = entry.person?.name;
	if (space.kind === "direct_message" && person) {
		return `${person}'s chat`;
	}
	return spaceNames.get(space.spaceId) ?? "the Space";
}

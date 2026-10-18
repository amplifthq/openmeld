import type { AuthProfileView } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { ChatCircleTextIcon, PlusIcon } from "@phosphor-icons/react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppContextualSidebarNav } from "#/components/app/app-contextual-layout";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { agentDirectMessageSessionsQueryOptions } from "#/query/organizations/agent-direct-message-sessions";
import type { MemberAgentDirectoryRow } from "./member-agent-directory-model";
import {
	formatMemberAgentWorkload,
	HarnessLogo,
	MemberAgentStateBadge,
} from "./member-agent-directory-section";
import { formatMemberAgentProfileDisplayName } from "./member-agent-display-name";

export function MemberAgentDetail(input: {
	row: MemberAgentDirectoryRow;
	onSelectProfile: (profileId: string) => void;
	onCreateProfile?: () => void;
}) {
	const { currentOrganization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const { row } = input;
	const latest = row.latestSession;
	return (
		<div className="mx-auto w-full max-w-5xl space-y-6 px-[var(--app-page-inline-padding)] py-6">
			<header className="flex flex-wrap items-center gap-3">
				<HarnessLogo harnessKind={row.harnessKind} size={44} />
				<div className="min-w-0 flex-1">
					<h1 className="truncate font-medium text-xl">{row.displayName}</h1>
					<p className="text-muted-foreground text-sm">
						{row.profiles.length}{" "}
						{row.profiles.length === 1 ? "Profile" : "Profiles"}
					</p>
				</div>
				<MemberAgentStateBadge state={row.presence.state} />
				{input.onCreateProfile ? (
					<Button onClick={input.onCreateProfile} size="sm">
						<PlusIcon aria-hidden="true" />
						New Profile
					</Button>
				) : null}
			</header>
			<dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<SummaryItem label="State">
					<MemberAgentStateBadge state={row.presence.state} />
				</SummaryItem>
				<SummaryItem label="Computers">
					{row.presence.computers.length > 0
						? row.presence.computers.join(", ")
						: "No computer reported yet"}
				</SummaryItem>
				<SummaryItem label="Work">
					{formatMemberAgentWorkload(row.presence)}
				</SummaryItem>
				<SummaryItem label="Latest session">
					{latest ? (
						<Link
							className="underline-offset-4 hover:underline"
							to={buildOrganizationDirectMessagePath({
								orgSlug: currentOrganization.slug,
								spaceId: latest.spaceId,
								search: { profileId: defaultHumanProfile?.openMeldProfileId },
							})}
						>
							{latest.title}
						</Link>
					) : (
						"No chats yet"
					)}
				</SummaryItem>
			</dl>
			<section aria-label="Profiles" className="space-y-2">
				<h2 className="font-medium text-sm">Profiles</h2>
				<ul className="divide-y rounded-lg border">
					{row.profiles.map((profile) => (
						<li key={profile.openMeldProfileId}>
							<button
								className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => input.onSelectProfile(profile.openMeldProfileId)}
								type="button"
							>
								<span className="min-w-0 flex-1 truncate">
									{formatMemberAgentProfileDisplayName({
										memberAgentName: row.displayName,
										profileName: profile.profileName,
										isDefaultProfile:
											profile.openMeldProfileId === row.defaultProfileId,
									})}
								</span>
								{profile.openMeldProfileId === row.defaultProfileId ? (
									<Badge variant="outline">Default</Badge>
								) : null}
							</button>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}

function SummaryItem(input: { label: string; children: React.ReactNode }) {
	return (
		<div className="rounded-lg border px-4 py-3">
			<dt className="text-muted-foreground text-xs">{input.label}</dt>
			<dd className="mt-1 truncate text-sm">{input.children}</dd>
		</div>
	);
}

/**
 * Secondary sidebar of a MemberAgent: its Profiles, each expanding to its
 * Direct Message Sessions with the signed-in member, filtered by state.
 */
export function MemberAgentProfileSessionsSidebar(input: {
	displayName: string;
	profiles: readonly AuthProfileView[];
	defaultProfileId: string | null;
}) {
	const { currentOrganization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const [state, setState] = useState<"active" | "archived">("active");
	const [search, setSearch] = useState("");
	const sessions = useQueries({
		queries: input.profiles.map((profile) =>
			agentDirectMessageSessionsQueryOptions({
				organizationId: currentOrganization.id,
				agentProfileId: profile.openMeldProfileId,
				archived: state === "archived",
				enabled: true,
			})
		),
	});
	const term = search.trim().toLocaleLowerCase();
	return (
		<AppContextualSidebarNav
			activeItemId={null}
			ariaLabel={`${input.displayName} Profiles`}
			groups={input.profiles.map((profile, index) => {
				const query = sessions[index];
				const items = (query?.data?.sessions ?? [])
					.map((session) => ({
						id: session.spaceId,
						icon: ChatCircleTextIcon,
						label: session.name ?? "New chat",
						to: buildOrganizationDirectMessagePath({
							orgSlug: currentOrganization.slug,
							spaceId: session.spaceId,
							search: { profileId: defaultHumanProfile?.openMeldProfileId },
						}),
					}))
					.filter((item) => item.label.toLocaleLowerCase().includes(term));
				return {
					id: profile.openMeldProfileId,
					ariaLabel: `${profile.profileName} Sessions`,
					label: formatMemberAgentProfileDisplayName({
						memberAgentName: input.displayName,
						profileName: profile.profileName,
						isDefaultProfile:
							profile.openMeldProfileId === input.defaultProfileId,
					}),
					labelAccessory: query?.isError ? (
						<span className="text-destructive text-xs">Couldn’t load</span>
					) : undefined,
					items,
				};
			})}
			leadingContent={
				<div className="space-y-2 px-1">
					<Tabs
						onValueChange={(value) =>
							setState(value === "archived" ? "archived" : "active")
						}
						value={state}
					>
						<TabsList aria-label="Session state" className="w-full">
							<TabItem label="Active" value="active" />
							<TabItem label="Archived" value="archived" />
						</TabsList>
					</Tabs>
					<Input
						aria-label="Search sessions"
						className="h-8"
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search sessions"
						value={search}
					/>
				</div>
			}
			placement="module"
			title={input.displayName}
		/>
	);
}

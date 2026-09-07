"use client";

import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	APPLICATION_SHORTCUTS,
	navigationShortcutKeys,
} from "@openmeld/ui/lib/application-shortcuts";
import {
	ArrowRightIcon,
	ChatCircleTextIcon,
	DesktopIcon,
	HashIcon,
	MoonIcon,
	PlusIcon,
	SunIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	isDirectMessageItem,
	resolveAccountSpaceTrailingStatus,
} from "#/components/spaces/account-space-sections";
import { NewDirectMessageDialog } from "#/components/spaces/new-direct-message-dialog";
import { SpaceActiveWakeIndicator } from "#/components/spaces/space-active-wake-indicator";
import { resolveSpaceActiveWakePresentation } from "#/components/spaces/space-active-wake-presentation";
import {
	resolveSpaceMemberAppearances,
	type SpaceMemberAppearance,
	SpaceMemberAvatars,
} from "#/components/spaces/space-member-avatars";
import { SpaceProfileIcon } from "#/components/spaces/space-profile-icon";
import { useAccountSpacePinMutation } from "#/components/spaces/use-account-space-pin-mutation";
import { useSpaceListIndicators } from "#/components/spaces/use-space-list-indicators";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAccountSettingsPath,
	buildOrganizationAgentCreationPath,
	buildOrganizationAgentsPath,
	buildOrganizationAppearanceSettingsPath,
	buildOrganizationComputersPath,
	buildOrganizationConnectPath,
	buildOrganizationDefaultPath,
	buildOrganizationDirectMessagePath,
	buildOrganizationDirectMessagesPath,
	buildOrganizationInboxPath,
	buildOrganizationNewSpacePath,
	buildOrganizationNotificationsSettingsPath,
	buildOrganizationPeoplePath,
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import type {
	AccountSpaceItem,
	AccountSpaceSections,
} from "#/lib/spaces/account-spaces";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { CommandCenterList, type CommandEntry } from "./command-center-list";
import { recentSpaceIds, recordRecentSpace } from "./command-recent-spaces";
import { useAppKeyboardShortcuts } from "./use-app-keyboard-shortcuts";

const EMPTY_SECTIONS: AccountSpaceSections = {
	pinnedItems: [],
	spaceItems: [],
};

export function AppCommandCenter() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [newMessage, setNewMessage] = useState(false);
	const toggleCommandCenter = useCallback(() => {
		setQuery("");
		setOpen((value) => !value);
	}, []);
	useAppKeyboardShortcuts(toggleCommandCenter);
	const { currentOrganization, currentUserId } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const currentSpaceId = useMatches({
		select: (matches) => {
			for (const match of [...matches].reverse()) {
				if (
					"spaceId" in match.params &&
					typeof match.params.spaceId === "string"
				) {
					return match.params.spaceId;
				}
			}
			return "";
		},
	});
	const key = `openmeld:recent-spaces:${currentUserId}:${currentOrganization.id}`;
	const [recent, setRecent] = useState<string[]>([]);
	useEffect(() => {
		let ids: string[] = [];
		try {
			ids = recentSpaceIds(localStorage.getItem(key));
		} catch {
			/* Browser storage may be unavailable. */
		}
		if (currentSpaceId) {
			ids = recordRecentSpace(ids, currentSpaceId);
			try {
				localStorage.setItem(key, JSON.stringify(ids));
			} catch {
				/* Recency remains usable in this session. */
			}
		}
		setRecent(ids);
	}, [key, currentSpaceId]);
	useEffect(() => {
		const show = () => {
			setQuery("");
			setOpen(true);
		};
		window.addEventListener("openmeld:command-center", show);
		return () => {
			window.removeEventListener("openmeld:command-center", show);
		};
	}, []);
	useEffect(() => {
		setOpen(false);
		setQuery("");
	}, []);
	return (
		<>
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent
					className="gap-0 overflow-hidden rounded-xl border border-border p-0 data-closed:animate-none data-open:animate-none sm:max-w-[600px]"
					showCloseButton={false}
				>
					<DialogTitle className="sr-only">Command center</DialogTitle>
					{open && (
						<CommandCenterContents
							close={() => setOpen(false)}
							currentSpaceId={currentSpaceId}
							key={key}
							newMessage={() => {
								setOpen(false);
								setNewMessage(true);
							}}
							onQueryChange={setQuery}
							profileId={profileId}
							query={query}
							recent={recent}
						/>
					)}
				</DialogContent>
			</Dialog>
			<NewDirectMessageDialog onOpenChange={setNewMessage} open={newMessage} />
		</>
	);
}

function CommandCenterContents(input: {
	profileId: string;
	currentSpaceId: string;
	recent: string[];
	query: string;
	onQueryChange: (value: string) => void;
	close: () => void;
	newMessage: () => void;
}) {
	const { currentOrganization } = useAppOrganization();
	const orgSlug = currentOrganization.slug;
	const navigate = useNavigate();
	const { resolvedTheme, setTheme } = useTheme();
	const spaces = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!input.profileId,
			profileId: input.profileId,
			scope: "account",
		})
	);
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: !!input.profileId,
			organizationId: currentOrganization.id,
		})
	);
	const sections = spaces.data ?? EMPTY_SECTIONS;
	const indicators = useSpaceListIndicators({
		currentProfileId: input.profileId,
		currentSpaceId: input.currentSpaceId,
		organizationId: currentOrganization.id,
		sections,
	});
	const pin = useAccountSpacePinMutation({ currentProfileId: input.profileId });
	const go = (to: string) => {
		input.close();
		navigate({ to }).catch((error: Error) => toast.error(error.message));
	};
	const items = [
		...new Map(
			[...sections.pinnedItems, ...sections.spaceItems]
				.filter((item) => item.organizationId === currentOrganization.id)
				.map((item) => [item.spaceId, item])
		).values(),
	];
	const searching = !!input.query.trim();
	const visibleSpaces = searching
		? items
		: input.recent
				.flatMap((id) => {
					const item = items.find((candidate) => candidate.spaceId === id);
					return item ? [item] : [];
				})
				.slice(0, 7);
	const appearances = resolveSpaceMemberAppearances(directory.data);
	const entries = visibleSpaces.map((item) =>
		spaceCommandEntry(
			item,
			indicators,
			searching,
			orgSlug,
			input.profileId,
			go,
			appearances
		)
	);
	if (searching) {
		entries.push(...profileCommandEntries(directory.data, orgSlug, go));
	}
	const link = (
		label: string,
		to: string,
		group: string,
		keywords = ""
	): CommandEntry => ({
		id: `action:${label}`,
		label,
		group,
		keywords,
		leading:
			group === "Quick actions" ? (
				<PlusIcon className="size-4" />
			) : (
				<ArrowRightIcon className="size-4" />
			),
		run: () => go(to),
	});
	entries.push(
		link(
			"New Space",
			buildOrganizationNewSpacePath(orgSlug),
			"Quick actions",
			"create add"
		),
		link(
			"New Agent",
			buildOrganizationAgentCreationPath(orgSlug),
			"Quick actions",
			"create add"
		),
		{
			id: "new-message",
			label: "New message",
			group: "Quick actions",
			keywords: "chat dm private",
			leading: <ChatCircleTextIcon className="size-4" />,
			run: input.newMessage,
		},
		link(
			"Connect a computer",
			buildOrganizationConnectPath({ orgSlug }),
			"Quick actions",
			"setup device"
		)
	);
	const current = items.find((item) => item.spaceId === input.currentSpaceId);
	if (current) {
		entries.push({
			id: "pin-current",
			label: current.pinnedAt ? "Unpin Space" : "Pin Space",
			group: "Current Space",
			description: current.spaceName,
			run: () => {
				pin.toggle(current).then((success) => {
					if (success) {
						input.close();
					}
				});
			},
		});
	}
	for (const [label, to, destination] of [
		["Desk", buildOrganizationDefaultPath(orgSlug), "home"],
		["Spaces", buildOrganizationSpacesPath(orgSlug), "spaces"],
		["Chats", buildOrganizationDirectMessagesPath(orgSlug), "messages"],
		["People", buildOrganizationPeoplePath(orgSlug), "people"],
		["Agents", buildOrganizationAgentsPath(orgSlug), "agents"],
		["Inbox", buildOrganizationInboxPath(orgSlug), "inbox"],
		["Computers", buildOrganizationComputersPath(orgSlug), "computers"],
	] as const) {
		entries.push({
			...link(label, to, "Go to"),
			shortcut: navigationShortcutKeys(destination),
		});
	}
	entries.push({
		id: "toggle-theme",
		label: "Toggle light/dark theme",
		group: "Settings",
		keywords: "appearance mode",
		leading: <SunIcon className="size-4" />,
		shortcut: ["Shift", APPLICATION_SHORTCUTS.theme.toUpperCase()],
		actionLabel: "Change theme",
		run: () => {
			setTheme(resolvedTheme === "dark" ? "light" : "dark");
			input.close();
		},
	});
	for (const [label, to] of [
		["Account settings", buildOrganizationAccountSettingsPath(orgSlug)],
		["Appearance", buildOrganizationAppearanceSettingsPath(orgSlug)],
		["Notifications", buildOrganizationNotificationsSettingsPath(orgSlug)],
	] as const) {
		entries.push(link(label, to, "Settings", "settings preferences"));
	}
	const themeIcons = {
		light: <SunIcon className="size-4" />,
		dark: <MoonIcon className="size-4" />,
		system: <DesktopIcon className="size-4" />,
	};
	if (!searching) {
		entries.push({
			id: "choose-theme",
			label: "Theme",
			group: "Settings",
			leading: <SunIcon className="size-4" />,
			actionLabel: "Choose theme",
			run: () => input.onQueryChange("theme"),
		});
	}
	for (const theme of ["light", "dark", "system"] as const) {
		if (!searching) {
			continue;
		}
		entries.push({
			id: `theme:${theme}`,
			label: `Use ${theme} theme`,
			keywords: "appearance mode",
			group: "Settings",
			leading: themeIcons[theme],
			actionLabel: "Change theme",
			run: () => {
				setTheme(theme);
				input.close();
			},
		});
	}
	return (
		<CommandCenterList
			entries={entries}
			error={spaces.isError || directory.isError}
			loading={spaces.isPending || directory.isPending}
			onQueryChange={input.onQueryChange}
			query={input.query}
		/>
	);
}

function spaceCommandEntry(
	item: AccountSpaceItem,
	indicators: ReturnType<typeof useSpaceListIndicators>,
	searching: boolean,
	orgSlug: string,
	profileId: string,
	go: (to: string) => void,
	appearances: ReadonlyMap<string, SpaceMemberAppearance>
): CommandEntry {
	const summary = indicators.activeWakeSummaryBySpaceId.get(item.spaceId);
	const status = summary ? resolveSpaceActiveWakePresentation(summary) : null;
	const unread =
		(indicators.unreadBySpaceId.get(item.spaceId)?.unreadCount ?? 0) > 0;
	return {
		id: item.spaceId,
		group: searching ? "Spaces" : "Recent Spaces",
		label: item.spaceName,
		keywords: item.spacePurpose ?? "",
		actionLabel: "Open Space",
		leading: item.memberPreviews?.length ? (
			<SpaceMemberAvatars
				appearances={appearances}
				members={item.memberPreviews}
			/>
		) : (
			<HashIcon className="size-4" />
		),
		trailing: <CommandSpaceStatus status={status} unread={unread} />,
		accessibleLabel: [
			item.spaceName,
			status?.label,
			unread ? "Unread messages" : "",
		]
			.filter(Boolean)
			.join(", "),
		description: undefined,
		run: () =>
			go(
				(isDirectMessageItem(item)
					? buildOrganizationDirectMessagePath
					: buildOrganizationSpacePath)({
					orgSlug,
					spaceId: item.spaceId,
					search: { profileId },
				})
			),
	};
}
function CommandSpaceStatus({
	status,
	unread,
}: {
	status: ReturnType<typeof resolveSpaceActiveWakePresentation> | null;
	unread: boolean;
}) {
	const trailing = resolveAccountSpaceTrailingStatus({
		hasActiveWake: !!status,
		hasUnread: unread,
		isPinned: false,
	});
	if (trailing === "working" && status) {
		return (
			<Tooltip>
				<TooltipTrigger render={<span aria-label={status.label} role="img" />}>
					<SpaceActiveWakeIndicator presentation={status} />
				</TooltipTrigger>
				<TooltipContent>{status.label}</TooltipContent>
			</Tooltip>
		);
	}
	if (trailing === "unread") {
		return (
			<span
				aria-label="Unread messages"
				className="size-1.5 rounded-full bg-unread"
				role="img"
			/>
		);
	}
	return null;
}

function profileCommandEntries(
	directory: OrganizationProfileDirectoryResponse | undefined,
	orgSlug: string,
	go: (to: string) => void
): CommandEntry[] {
	const entries: CommandEntry[] = [];
	for (const member of directory?.members ?? []) {
		const profile = member.humanProfile;
		if (!profile || profile.status !== "active") {
			continue;
		}
		entries.push({
			id: `person:${profile.profileId}`,
			group: "People",
			label: profile.profileName,
			keywords: member.user.email,
			leading: (
				<SpaceProfileIcon
					agentControllerRef={null}
					avatarImageUrl={member.user.image}
					profileId={profile.profileId}
					profileKind="human"
					profileName={profile.profileName}
				/>
			),
			actionLabel: "Open person",
			run: () =>
				go(
					`${buildOrganizationPeoplePath(orgSlug)}?profileId=${encodeURIComponent(profile.profileId)}`
				),
		});
	}
	for (const profile of directory?.agentProfiles ?? []) {
		entries.push({
			id: `agent:${profile.profileId}`,
			group: "Agents",
			label: profile.profileName,
			description:
				profile.ownerName ??
				directory?.members.find(
					(member) => member.user.id === profile.ownerUserId
				)?.user.name,
			keywords: `${profile.profileHandle} ${profile.ownerName ?? ""}`,
			leading: (
				<SpaceProfileIcon
					agentControllerRef={profile.agentControllerRef}
					profileId={profile.profileId}
					profileKind="agent"
					profileName={profile.profileName}
				/>
			),
			actionLabel: "Open Agent",
			run: () =>
				go(
					`${buildOrganizationAgentsPath(orgSlug)}?profileId=${encodeURIComponent(profile.profileId)}`
				),
		});
	}
	return entries;
}

import {
	normalizeSpacePasswordText,
	spaceAccessModeUsesPassword,
} from "@openmeld/schemas";
import type {
	SpaceAccessMode,
	SpaceLinkJoinPolicy,
} from "@openmeld/schemas/types";
import { buildPublicSpaceEntryUrl } from "@openmeld/space";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { CopyIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { env } from "#/env";
import { copyTextToClipboard } from "#/lib/clipboard";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { spaceMembersQueryOptions } from "#/query/spaces/members";
import {
	SpaceAccessEditor,
	type SpaceAccessUpdateInput,
} from "./space-access-editor";
import { SpaceGuestAccessSection } from "./space-guest-access-section";
import { SpaceInvitationForm } from "./space-invitations-section";
import { SpaceOwnersSection } from "./space-owners-section";
import {
	createSpaceSharingDraft,
	spaceSharingDraftsMatch,
} from "./space-sharing-model";
import { SpaceVisibilityPicker } from "./space-visibility-picker";

export type SpaceAccessSettingsProps = {
	surface?: "settings" | "share";
	openMeldProfileId?: string;
	accessMode: SpaceAccessMode;
	allowGuests?: boolean;
	canManageAccess: boolean;
	errorMessage: string | null;
	isPending: boolean;
	linkJoinPolicy?: SpaceLinkJoinPolicy;
	onOpenAccessSettings?: () => void;
	onOpenShare?: () => void;
	onSetAccessMode: (input: SpaceAccessUpdateInput) => Promise<void>;
	onSetVisibility?: (visibility: "public" | "private") => Promise<void>;
	spaceId: string;
	visibility?: "public" | "private";
};

// Share and Access intentionally share one draft owner so switching surfaces cannot
// silently apply or discard policy changes.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this component coordinates the shared draft, save, copy, and guarded handoff lifecycle.
export function SpaceAccessSettings(input: SpaceAccessSettingsProps) {
	const scope = useOptionalAppOrganization();
	const organization = scope?.currentOrganization;
	const generalAccessId = useId();
	const sourceDraft = createSpaceSharingDraft(input);
	const [baseline, setBaseline] = useState(sourceDraft);
	const [draft, setDraft] = useState(sourceDraft);
	const [password, setPassword] = useState("");
	const [isCommitting, setIsCommitting] = useState(false);
	const commitInFlightRef = useRef(false);
	const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(
		null
	);
	const [pendingHandoff, setPendingHandoff] = useState<
		"access" | "share" | null
	>(null);
	const normalizedPassword = normalizeSpacePasswordText(password);
	const hasPasswordChange = normalizedPassword.length > 0;
	const isDirty =
		!spaceSharingDraftsMatch(draft, baseline) || hasPasswordChange;
	const mustSetPassword =
		spaceAccessModeUsesPassword(draft.accessMode) &&
		!spaceAccessModeUsesPassword(input.accessMode);
	const saveDisabled =
		input.isPending ||
		isCommitting ||
		!isDirty ||
		(mustSetPassword && !hasPasswordChange);
	const isShare = input.surface === "share";
	const spaceUrl = buildPublicSpaceEntryUrl({
		origin: resolveSpaceShareOrigin(),
		target: { spaceId: input.spaceId },
	});

	useEffect(() => {
		const next = createSpaceSharingDraft({
			accessMode: input.accessMode,
			linkJoinPolicy: input.linkJoinPolicy,
		});
		setBaseline(next);
		setDraft(next);
		setPassword("");
		setLocalErrorMessage(null);
	}, [input.accessMode, input.linkJoinPolicy]);

	const visibilitySave = useMutation({
		mutationFn: async (value: "public" | "private") => {
			if (!input.onSetVisibility) {
				throw new Error(
					"Couldn't change access. Reopen settings and try again."
				);
			}
			await input.onSetVisibility(value);
		},
	});
	const everyoneLabel = organization
		? `Everyone at ${organization.name}`
		: "Everyone in the organization";

	const resetDraft = () => {
		setDraft(baseline);
		setPassword("");
		setLocalErrorMessage(null);
	};

	const saveAccess = async (): Promise<boolean> => {
		if (saveDisabled || commitInFlightRef.current) {
			return false;
		}
		commitInFlightRef.current = true;
		setIsCommitting(true);
		setLocalErrorMessage(null);
		try {
			await input.onSetAccessMode({
				accessMode: draft.accessMode,
				linkJoinPolicy: draft.linkJoinPolicy,
				...(hasPasswordChange ? { password: normalizedPassword } : {}),
			});
			setBaseline(draft);
			setPassword("");
			return true;
		} catch (error: unknown) {
			setLocalErrorMessage(
				error instanceof Error
					? error.message
					: "OpenMeld could not update sharing."
			);
			return false;
		} finally {
			commitInFlightRef.current = false;
			setIsCommitting(false);
		}
	};

	const copyLink = async () => {
		if (await copyTextToClipboard(spaceUrl)) {
			toast.success("Space link copied.");
		} else {
			toast.error("Couldn't copy the link. Try again.");
		}
	};

	const openOtherSurface = (target: "access" | "share") => {
		if (isDirty) {
			setPendingHandoff(target);
			return;
		}
		(target === "access" ? input.onOpenAccessSettings : input.onOpenShare)?.();
	};

	const organizationSection = input.visibility ? (
		<section className="grid gap-2 border-border/60 border-t pt-4">
			<label className="font-medium text-sm" htmlFor={generalAccessId}>
				Organization
			</label>
			<SpaceVisibilityPicker
				disabled={
					!(
						input.canManageAccess &&
						input.onSetVisibility &&
						input.visibility
					) ||
					visibilitySave.isPending ||
					input.isPending
				}
				id={generalAccessId}
				onChange={(value) => visibilitySave.mutate(value)}
				value={input.visibility}
			/>
			<p className="text-muted-foreground text-xs/relaxed">
				{describeOrganizationAccess(input, everyoneLabel)}
			</p>
			{visibilitySave.isPending ? (
				<output className="block text-muted-foreground text-xs">Saving…</output>
			) : null}
			{visibilitySave.error ? (
				<p className="text-destructive text-xs" role="alert">
					{visibilitySave.error.message}
				</p>
			) : null}
		</section>
	) : null;

	const linkSectionFooter = (
		<div className="space-y-2 pt-1">
			<div className="flex min-w-0 items-center gap-2">
				<Input
					aria-label="Space link"
					className="min-w-0 flex-1 text-muted-foreground"
					readOnly
					value={spaceUrl}
				/>
				<a
					className={buttonVariants({ size: "sm", variant: "outline" })}
					href={spaceUrl}
					rel="noreferrer"
					target="_blank"
				>
					Open
				</a>
			</div>
			{baseline.accessMode === "members_only" &&
			draft.accessMode !== "members_only" ? (
				<p className="text-amber-700 text-xs/relaxed dark:text-amber-300">
					Anyone with the link will be able to read all existing and future
					messages, Threads, files, and shared Space context.
				</p>
			) : null}
			{spaceAccessModeUsesPassword(input.accessMode) &&
			!spaceAccessModeUsesPassword(draft.accessMode) ? (
				<p className="text-muted-foreground text-xs/relaxed">
					Saving removes the current Space password because the new policy no
					longer uses it.
				</p>
			) : null}
		</div>
	);

	const editor = (
		<SpaceAccessEditor
			allowGuests={input.allowGuests}
			canManageAccess={input.canManageAccess}
			currentAccessMode={input.accessMode}
			disabled={input.isPending}
			draft={draft}
			errorMessage={localErrorMessage ?? input.errorMessage}
			linkSectionFooter={linkSectionFooter}
			onDraftChange={(nextDraft) => {
				setDraft(nextDraft);
				setPassword("");
				setLocalErrorMessage(null);
			}}
			onPasswordChange={(value) => {
				setPassword(value);
				setLocalErrorMessage(null);
			}}
			organizationSection={organizationSection}
			password={password}
		/>
	);

	const body = (
		<div className="min-w-0 space-y-4">
			{!isShare && input.onOpenShare ? (
				<div className="flex justify-end">
					<Button
						onClick={() => openOtherSurface("share")}
						size="sm"
						type="button"
						variant="outline"
					>
						Open Share
					</Button>
				</div>
			) : null}
			{editor}
			{organization && !organization.isPersonal && input.canManageAccess ? (
				<SpaceGuestAccessSection
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
					surface="settings"
				/>
			) : null}
			{scope && isShare ? (
				<SpaceAccessInvitations
					canInviteGuests={input.canManageAccess}
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
				/>
			) : null}
			{!isShare && input.canManageAccess ? (
				<div className="flex items-center justify-end gap-2">
					{isDirty ? (
						<span className="mr-auto text-muted-foreground text-xs">
							Not saved
						</span>
					) : null}
					{isDirty ? (
						<Button
							onClick={resetDraft}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
					) : null}
					<Button
						disabled={saveDisabled}
						onClick={() => {
							saveAccess().catch((error) => {
								console.error("Failed to update Space access.", error);
							});
						}}
						size="sm"
						type="button"
					>
						{input.isPending ? "Saving…" : "Save access"}
					</Button>
				</div>
			) : null}
			{isShare ? null : (
				<SpaceOwnersSection
					canManage={input.canManageAccess}
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
				/>
			)}
		</div>
	);

	return (
		<>
			{isShare ? (
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<ScrollArea
						className="min-h-0 min-w-0 flex-1"
						contentClassName="pr-1"
						data-testid="space-share-dialog-scroll-area"
						orientation="vertical"
					>
						{body}
					</ScrollArea>
					<footer className="mt-4 flex shrink-0 items-center gap-2 border-border/60 border-t pt-4">
						{input.onOpenAccessSettings ? (
							<Button
								onClick={() => openOtherSurface("access")}
								size="sm"
								type="button"
								variant="ghost"
							>
								Manage access settings
							</Button>
						) : null}
						{isDirty ? (
							<span className="text-muted-foreground text-xs">Not saved</span>
						) : null}
						<div className="ml-auto flex items-center gap-2">
							{isDirty ? (
								<Button
									disabled={input.isPending}
									onClick={resetDraft}
									size="sm"
									type="button"
									variant="ghost"
								>
									Cancel
								</Button>
							) : null}
							<Button
								disabled={isDirty && saveDisabled}
								onClick={async () => {
									if (isDirty && !(await saveAccess())) {
										return;
									}
									await copyLink();
								}}
								size="sm"
								type="button"
							>
								<CopyIcon aria-hidden="true" />
								{resolveShareActionLabel({ baseline, draft, isDirty })}
							</Button>
						</div>
					</footer>
				</div>
			) : (
				body
			)}

			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						setPendingHandoff(null);
					}
				}}
				open={pendingHandoff !== null}
			>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Discard unsaved access changes?</DialogTitle>
						<DialogDescription>
							Your changes have not been applied to this Space.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button onClick={() => setPendingHandoff(null)} variant="ghost">
							Keep editing
						</Button>
						<Button
							onClick={() => {
								const target = pendingHandoff;
								resetDraft();
								setPendingHandoff(null);
								(target === "access"
									? input.onOpenAccessSettings
									: input.onOpenShare)?.();
							}}
							variant="destructive"
						>
							Discard and continue
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function resolveShareActionLabel(input: {
	baseline: { accessMode: SpaceAccessMode };
	draft: { accessMode: SpaceAccessMode };
	isDirty: boolean;
}): string {
	if (!input.isDirty) {
		return "Copy link";
	}
	if (
		input.baseline.accessMode === "members_only" &&
		input.draft.accessMode !== "members_only"
	) {
		return "Enable and copy";
	}
	return "Save and copy";
}

function resolveSpaceShareOrigin(): string {
	const currentUrl = new URL(window.location.href);
	if (currentUrl.protocol === "http:" || currentUrl.protocol === "https:") {
		return currentUrl.origin;
	}
	const configuredUrl = env.VITE_BETTER_AUTH_URL;
	if (configuredUrl) {
		const parsed = new URL(configuredUrl);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return parsed.origin;
		}
	}
	return "https://openmeld.ai";
}

function describeOrganizationAccess(
	input: SpaceAccessSettingsProps,
	everyoneLabel: string
): string {
	if (!input.visibility) {
		return "Organization access is currently unavailable.";
	}
	if (input.visibility === "public") {
		return `${everyoneLabel} can find and join this Space.`;
	}
	return "Only invited people can find this Space in the organization.";
}

function SpaceAccessInvitations(input: {
	spaceId: string;
	canInviteGuests: boolean;
	openMeldProfileId?: string;
}) {
	const [audience, setAudience] = useState<"organization" | "guest">(
		input.canInviteGuests ? "guest" : "organization"
	);
	const scope = useOptionalAppOrganization();
	const members = useQuery(
		spaceMembersQueryOptions({
			spaceId: input.spaceId,
			enabled: Boolean(
				scope?.currentOrganization && !scope.currentOrganization.isPersonal
			),
		})
	);
	const canInvite = [
		...(members.data?.humans ?? []),
		...(members.data?.agents ?? []),
	].some(
		(person) =>
			person.status === "active" && person.ownerUserId === scope?.currentUserId
	);
	if (scope?.currentOrganization.isPersonal) {
		return null;
	}
	if (members.isError) {
		return (
			<div className="flex items-center justify-between gap-2 text-xs">
				<span>Couldn't load invitation options.</span>
				<Button onClick={() => members.refetch()} size="sm" variant="ghost">
					Try again
				</Button>
			</div>
		);
	}
	if (members.isPending) {
		return (
			<p className="text-muted-foreground text-xs">
				Loading invitation options…
			</p>
		);
	}
	if (!canInvite) {
		return null;
	}
	return (
		<section className="grid gap-2 border-border/60 border-t pt-4">
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-medium text-sm">Invite people</h3>
				{input.canInviteGuests ? (
					<Select
						onValueChange={(value) => {
							if (value === "organization" || value === "guest") {
								setAudience(value);
							}
						}}
						value={audience}
					>
						<SelectTrigger
							aria-label="Invite as"
							className="w-fit min-w-0"
							displayValue={audience === "guest" ? "Guest" : "Teammate"}
						/>
						<SelectContent>
							<SelectItem index={0} value="guest">
								Guest
							</SelectItem>
							<SelectItem index={1} value="organization">
								Teammate
							</SelectItem>
						</SelectContent>
					</Select>
				) : null}
			</div>
			{audience === "guest" && input.canInviteGuests ? (
				<SpaceGuestAccessSection
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
					surface="share"
				/>
			) : (
				<SpaceInvitationForm spaceId={input.spaceId} />
			)}
		</section>
	);
}

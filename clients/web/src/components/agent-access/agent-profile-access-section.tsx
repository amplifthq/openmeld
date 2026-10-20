import type { AgentProfileAccessGrantView } from "@openmeld/schemas";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { UsersThreeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	useAgentProfileAccessGrants,
	useRevokeAgentProfileAccessGrant,
} from "#/query/agent-access";
import { organizationProfileIdentityDirectoryQueryOptions } from "#/query/organizations/organization-directory";

const ACCESS_AVATAR_SIZE = 28;

/**
 * Owner-only, collapsed until opened: who may use this Agent without asking,
 * with Revoke, then any other sensitive history the page adds (`children`),
 * all in one scroll area.
 */
export function AgentProfileAccessSection(input: {
	enabled: boolean;
	profileId: string;
	children?: ReactNode;
}) {
	if (!(input.enabled && isMemberAgentsEnabled())) {
		return null;
	}
	return (
		<section aria-labelledby="agent-access-heading" className="max-w-3xl">
			<Accordion>
				<AccordionItem value="access">
					<AccordionTrigger className="py-1">
						<span
							className="block font-medium text-sm"
							id="agent-access-heading"
						>
							Who can use this Agent
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<ScrollArea
							className="mt-2 max-h-[28rem]"
							data-slot="agent-access-scroll"
						>
							<div className="grid gap-5 pr-3">
								<AgentProfileAccessList profileId={input.profileId} />
								{input.children}
							</div>
						</ScrollArea>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</section>
	);
}

function AgentProfileAccessList(input: { profileId: string }) {
	const grants = useAgentProfileAccessGrants(input.profileId);
	const revoke = useRevokeAgentProfileAccessGrant(input.profileId);
	const avatars = useGranteeAvatars();
	const [confirming, setConfirming] =
		useState<AgentProfileAccessGrantView | null>(null);
	if (grants.isPending) {
		return <SkeletonRows label="Loading access" rows={2} />;
	}
	return (
		<div className="grid gap-1">
			{grants.isError ? (
				<p className="text-destructive text-sm" role="alert">
					Couldn't load who can use this Agent.
				</p>
			) : null}
			<ul aria-label="Who can use this Agent" className="grid">
				{(grants.data ?? []).map((grant) => (
					<AccessRow
						action={
							<Button
								aria-label={`Revoke ${grant.granteeName}`}
								className="opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
								disabled={revoke.isPending}
								onClick={() => setConfirming(grant)}
								size="sm"
								type="button"
								variant="ghost"
							>
								Revoke
							</Button>
						}
						detail={grant.scope === "always" ? "Can start work" : "One chat"}
						key={grant.id}
						leading={
							<DitherProfileAvatar
								avatarImageUrl={avatars.get(grant.granteeUserId)?.image}
								profileId={
									avatars.get(grant.granteeUserId)?.profileId ??
									grant.granteeUserId
								}
								profileKind="human"
								profileName={grant.granteeName}
								size={ACCESS_AVATAR_SIZE}
							/>
						}
						name={grant.granteeName}
					/>
				))}
				<AccessRow
					detail="Asks you first"
					leading={
						<span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-muted-foreground">
							<UsersThreeIcon aria-hidden="true" className="size-4" />
						</span>
					}
					name="Everyone else"
				/>
			</ul>
			{revoke.error ? (
				<p className="text-destructive text-sm" role="alert">
					{revoke.error.message}
				</p>
			) : null}
			<RevokeAccessDialog
				grant={confirming}
				onClose={() => setConfirming(null)}
				onRevoke={(grant) => revoke.mutate(grant.id)}
			/>
		</div>
	);
}

function AccessRow(input: {
	leading: ReactNode;
	name: string;
	detail: string;
	action?: ReactNode;
}) {
	return (
		<li className="group flex min-h-10 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40">
			{input.leading}
			<span className="min-w-0 flex-1 truncate text-sm">{input.name}</span>
			<span className="shrink-0 text-muted-foreground text-xs">
				{input.detail}
			</span>
			{input.action ? <span className="shrink-0">{input.action}</span> : null}
		</li>
	);
}

function RevokeAccessDialog(input: {
	grant: AgentProfileAccessGrantView | null;
	onClose: () => void;
	onRevoke: (grant: AgentProfileAccessGrantView) => void;
}) {
	const { grant } = input;
	return (
		<AlertDialog
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			open={grant !== null}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Revoke {grant?.granteeName}?</AlertDialogTitle>
					<AlertDialogDescription>
						They will ask you before new work. Anything already running
						finishes.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							if (grant) {
								input.onRevoke(grant);
							}
							input.onClose();
						}}
						variant="destructive"
					>
						Revoke
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** Colleagues' avatars by user, from the Organization Profile Directory. */
function useGranteeAvatars(): ReadonlyMap<
	string,
	{ profileId: string; image: string | null }
> {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	const directory = useQuery(
		organizationProfileIdentityDirectoryQueryOptions({
			enabled: Boolean(organizationId),
			organizationId,
		})
	);
	return new Map(
		(directory.data?.members ?? []).map((member) => [
			member.userId,
			{
				profileId: member.humanProfile?.profileId ?? member.userId,
				image: member.user.image,
			},
		])
	);
}

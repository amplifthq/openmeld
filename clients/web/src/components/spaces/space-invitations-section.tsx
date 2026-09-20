import type { SpaceInvitationRequest } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InvitationRequestLink } from "#/components/organizations/invitation-request-link";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	requestSpaceInvitations,
	SpaceInvitationRequestError,
} from "#/lib/organizations/space-invitations";
import { invitationRequestQueryKey } from "#/query/organizations/invitation-requests";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";

function canSendInvitation(
	audience: "organization" | "guest",
	role: Parameters<typeof canManageOrganizationArea>[0]
) {
	return (
		audience === "guest" ||
		canManageOrganizationArea(role, { invitation: ["create"] })
	);
}

function describeInvitationAudience(
	audience: "organization" | "guest",
	canInvite: boolean,
	organizationName: string
): string {
	if (audience === "guest") {
		return "Sign-in required.";
	}
	if (canInvite) {
		return `New teammates will join ${organizationName} and this Space.`;
	}
	return "An organization owner or admin must approve invitations for new teammates.";
}

export function SpaceInvitationsSection({
	spaceId,
	triggerLabel = "Invite",
}: {
	spaceId: string;
	triggerLabel?: string;
}) {
	const organization = useOptionalAppOrganization()?.currentOrganization;
	if (!organization || organization.isPersonal) {
		return null;
	}
	return (
		<Dialog>
			<DialogTrigger render={<Button size="xs" variant="outline" />}>
				<EnvelopeSimpleIcon aria-hidden="true" />
				{triggerLabel}
			</DialogTrigger>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>Invite teammates</DialogTitle>
					<DialogDescription className="sr-only">
						Invite someone to your organization and this Space.
					</DialogDescription>
				</DialogHeader>
				<SpaceInvitationForm spaceId={spaceId} />
			</DialogContent>
		</Dialog>
	);
}

type SpaceInvitationFormProps = {
	spaceId: string;
	audience?: "organization" | "guest";
	actionVariant?: "ghost" | "secondary";
	disabled?: boolean;
	onBeforeCreate?: (continueInvitation: () => void) => void;
	submitButtonTarget?: HTMLElement | null;
};

type InvitationDraft = { email: string };
type InvitationOperation = {
	request: SpaceInvitationRequest;
	submittedDraft?: InvitationDraft;
};

export function SpaceInvitationForm(props: SpaceInvitationFormProps) {
	const scope = useOptionalAppOrganization();
	return (
		<ScopedSpaceInvitationForm
			{...props}
			key={JSON.stringify([
				scope?.currentUserId,
				scope?.currentOrganization.id,
				props.spaceId,
				props.audience ?? "organization",
			])}
		/>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: invitation permissions, request fallback, and pending-invitation management intentionally remain one scoped form lifecycle.
function ScopedSpaceInvitationForm({
	spaceId,
	audience = "organization",
	actionVariant = "ghost",
	disabled = false,
	onBeforeCreate,
	submitButtonTarget,
}: SpaceInvitationFormProps) {
	const generatedFormId = useId();
	const formId = `space-invitation-${generatedFormId.replaceAll(":", "")}`;
	const scope = useOptionalAppOrganization();
	const organization = scope?.currentOrganization;
	const role = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: Boolean(organization && !organization.isPersonal),
			organizationId: organization?.id ?? "",
			userId: scope?.currentUserId ?? "",
		})
	);
	const canInvite = canSendInvitation(audience, role.data);
	// Each edit creates a distinct revision, even when the user returns to the
	// same text. A late completion may clear only its exact submitted revision.
	const [draft, setDraft] = useState<InvitationDraft>({ email: "" });
	const email = draft.email;
	const [sent, setSent] = useState<string | null>(null);
	const actionInFlightRef = useRef(false);
	const availabilityRef = useRef({ mounted: true, disabled: false });
	availabilityRef.current.disabled = disabled || role.isPending || role.isError;
	useEffect(() => {
		availabilityRef.current.mounted = true;
		return () => {
			availabilityRef.current.mounted = false;
		};
	}, []);
	const client = useQueryClient();
	const queryKey = [
		"space-invitations",
		scope?.currentUserId,
		organization?.id,
		spaceId,
		audience,
	];
	const query = useQuery({
		queryKey,
		queryFn: () =>
			requestSpaceInvitations({
				action: "list",
				organizationId: organization?.id ?? "",
				spaceId,
				audience,
			}),
		enabled: Boolean(organization && !organization.isPersonal && canInvite),
		retry: false,
	});
	const mutation = useMutation({
		mutationFn: ({ request }: InvitationOperation) =>
			requestSpaceInvitations(request),
		onSuccess: (_result, { request, submittedDraft }) => {
			if (!availabilityRef.current.mounted) {
				return;
			}
			if (request.action === "create") {
				setSent(
					`Invitation sent to ${request.email}. They’ll appear in this Space after accepting.`
				);
			} else if (request.action === "resend") {
				setSent(
					"Invitation resent. They’ll appear in this Space after accepting."
				);
			} else {
				setSent(null);
			}
			if (request.action === "create" && submittedDraft) {
				setDraft((current) =>
					current === submittedDraft ? { email: "" } : current
				);
			}
		},
		onSettled: () => {
			actionInFlightRef.current = false;
			return client.invalidateQueries({ queryKey });
		},
	});
	const proposal = useMutation({
		mutationFn: (submittedDraft: InvitationDraft) =>
			requestOrganizationJoinRequests({
				action: "create",
				organizationId: organization?.id ?? "",
				spaceId,
				email: submittedDraft.email,
			}),
		onSuccess: (_result, submittedDraft) => {
			if (availabilityRef.current.mounted) {
				setDraft((current) =>
					current === submittedDraft ? { email: "" } : current
				);
			}
			return client.invalidateQueries({ queryKey: invitationRequestQueryKey });
		},
		onSettled: () => {
			actionInFlightRef.current = false;
		},
	});
	const runInvitation = (operation: InvitationOperation) => {
		if (
			actionInFlightRef.current ||
			!availabilityRef.current.mounted ||
			availabilityRef.current.disabled
		) {
			return;
		}
		actionInFlightRef.current = true;
		mutation.mutate(operation);
	};
	if (!organization || organization.isPersonal) {
		return null;
	}
	if (role.isPending) {
		return (
			<output className="block text-muted-foreground text-xs">
				Checking invitation permissions…
			</output>
		);
	}
	if (role.isError) {
		return (
			<div className="flex items-center justify-between gap-2 text-xs">
				<p role="alert">Couldn't check invitation permissions.</p>
				<Button
					onClick={() => role.refetch()}
					size="sm"
					variant={actionVariant}
				>
					Try again
				</Button>
			</div>
		);
	}
	const createInvitation = () => {
		runInvitation({
			request: {
				action: "create",
				organizationId: organization.id,
				spaceId,
				email,
				audience,
			},
			submittedDraft: draft,
		});
	};
	const submitInvitation = () => {
		if (
			actionInFlightRef.current ||
			availabilityRef.current.disabled ||
			!email.trim()
		) {
			return;
		}
		setSent(null);
		if (!canInvite) {
			actionInFlightRef.current = true;
			proposal.mutate(draft);
			return;
		}
		if (onBeforeCreate) {
			onBeforeCreate(createInvitation);
			return;
		}
		createInvitation();
	};
	const submitLabel = resolveInvitationSubmitLabel(audience, canInvite);
	const submitButton = (
		<Button
			disabled={
				disabled ||
				mutation.isPending ||
				proposal.isPending ||
				role.isPending ||
				role.isError ||
				!email.trim()
			}
			form={formId}
			type="submit"
		>
			{submitLabel}
		</Button>
	);
	return (
		<div className="grid gap-2">
			<p className="text-muted-foreground text-xs/relaxed">
				{describeInvitationAudience(audience, canInvite, organization.name)}
			</p>
			<form
				className="grid gap-2"
				id={formId}
				onSubmit={(event) => {
					event.preventDefault();
					if (
						disabled ||
						role.isPending ||
						role.isError ||
						mutation.isPending ||
						proposal.isPending
					) {
						return;
					}
					submitInvitation();
				}}
			>
				<label
					className="sr-only"
					htmlFor={`space-invitation-email-${spaceId}-${audience}`}
				>
					Email address
				</label>
				<Input
					className="min-w-40 flex-1"
					disabled={disabled}
					id={`space-invitation-email-${spaceId}-${audience}`}
					onChange={(event) => setDraft({ email: event.target.value })}
					placeholder="name@example.com"
					required
					type="email"
					value={email}
				/>
				{submitButtonTarget ? null : submitButton}
			</form>
			{submitButtonTarget
				? createPortal(submitButton, submitButtonTarget)
				: null}
			{proposal.data?.[0] ? (
				<output className="block text-sm">
					Request submitted.{" "}
					<Link
						className="underline"
						params={{ orgSlug: organization.slug }}
						search={{ requestId: proposal.data[0].id }}
						to="/o/$orgSlug/inbox"
					>
						View request
					</Link>
				</output>
			) : null}
			{proposal.error ? (
				<p className="text-destructive text-sm" role="alert">
					{proposal.error.message}
				</p>
			) : null}
			{role.isSuccess && audience === "organization" ? (
				<InvitationRequestLink
					canManage={canInvite}
					className="mt-2"
					organizationId={organization.id}
					spaceId={spaceId}
				/>
			) : null}
			{sent && <output className="block text-sm">{sent}</output>}
			{(mutation.error || query.error) && (
				<p className="text-destructive text-sm" role="alert">
					{(mutation.error ?? query.error)?.message}
				</p>
			)}
			{mutation.error instanceof SpaceInvitationRequestError &&
				mutation.error.code === "space.invitation.revoke_incomplete" && (
					<Button
						disabled={disabled || mutation.isPending || proposal.isPending}
						onClick={() => {
							if (mutation.variables?.request.action === "revoke") {
								runInvitation(mutation.variables);
							}
						}}
						variant="outline"
					>
						Retry revoking invitation
					</Button>
				)}
			{Boolean(query.data?.length) && (
				<Accordion>
					<AccordionItem value="pending-invitations">
						<AccordionTrigger
							chevronClassName="motion-reduce:transition-none"
							className="py-1 text-muted-foreground text-xs"
						>
							Pending invitations ({query.data?.length})
						</AccordionTrigger>
						<AccordionContent className="motion-reduce:transition-none">
							<div className="pt-3">
								<div className="max-h-48 space-y-2 overflow-y-auto">
									{query.data?.map((invitation) => (
										<div
											className="flex items-center gap-2 text-sm"
											key={invitation.id}
										>
											<div className="min-w-0 flex-1">
												<p className="truncate">{invitation.email}</p>
												<p className="text-muted-foreground text-xs">
													{invitationStatusLabel(invitation.status)}
												</p>
											</div>
											<Button
												disabled={
													disabled || mutation.isPending || proposal.isPending
												}
												onClick={() =>
													runInvitation({
														request: {
															action: "resend",
															invitationId: invitation.id,
														},
													})
												}
												size="sm"
												variant={actionVariant}
											>
												Resend
											</Button>
											<Button
												disabled={
													disabled || mutation.isPending || proposal.isPending
												}
												onClick={() =>
													runInvitation({
														request: {
															action: "revoke",
															invitationId: invitation.id,
														},
													})
												}
												size="sm"
												variant={actionVariant}
											>
												Revoke
											</Button>
										</div>
									))}
								</div>
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			)}
		</div>
	);
}

function invitationStatusLabel(status: string): string {
	if (status === "expired") {
		return "Expired";
	}
	if (status === "accepting") {
		return "Joining — they can retry the invitation";
	}
	return "Waiting for acceptance";
}

function resolveInvitationSubmitLabel(
	audience: "organization" | "guest",
	canInvite: boolean
): string {
	if (!canInvite) {
		return "Request invitation";
	}
	return audience === "guest" ? "Invite guest" : "Invite teammate";
}

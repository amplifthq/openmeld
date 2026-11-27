"use client";

import type {
	OrganizationDirectoryResponse,
	OrganizationMemberRemovalPlan,
} from "@openmeld/schemas/types";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { removeOrganizationMember } from "#/lib/organizations/auth-organizations";
import {
	prepareOrganizationMemberRemoval,
	previewOrganizationMemberRemoval,
} from "#/lib/organizations/organization-member-removal";
import { organizationDirectoryQueryFilters } from "#/query/organizations/organization-directory";

type DirectoryMember = OrganizationDirectoryResponse["members"][number];

const SPACE_REMOVAL_ACTION_DESCRIPTIONS = {
	close: "Close this private Space and retain its history.",
	demote: "Existing owners will continue managing this Space.",
	transfer: "Transfer ownership to the member you choose below.",
} as const;

/** The same reviewed membership action is available in Settings and Team. */
export function OrganizationMemberRemovalAction(input: {
	disabled?: boolean;
	label?: string;
	member: DirectoryMember;
	members: readonly DirectoryMember[];
	onError: (message: string | null) => void;
	onRemoved?: () => void;
	onStarted?: () => void;
	organizationId: string;
	surface?: "team";
	variant?: "outline" | "destructive";
}) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [selectedSuccessorUserId, setSelectedSuccessorUserId] = useState<
		string | null
	>(null);
	// The role shown when the review opened. A directory refresh during the
	// review must not widen what the confirmation is allowed to remove.
	const [reviewedMemberRole, setReviewedMemberRole] = useState(
		input.member.role
	);
	const memberName =
		input.member.humanProfile?.profileName ?? input.member.user.name;
	const removalPreview = useMutation({
		mutationFn: async () => {
			const plan = await previewOrganizationMemberRemoval({
				memberId: input.member.memberId,
				organizationId: input.organizationId,
			});
			if (plan.userId !== input.member.userId) {
				throw new Error(
					"This member changed. Refresh the members list and try again."
				);
			}
			return plan;
		},
	});
	const defaultSuccessor = removalPreview.data?.defaultSuccessor;
	const successorUserId =
		selectedSuccessorUserId ?? defaultSuccessor?.userId ?? "";
	const usesDefaultSuccessor =
		defaultSuccessor !== undefined &&
		defaultSuccessor.userId === successorUserId;
	const nativeRemoval = {
		memberIdOrEmail: input.member.memberId,
		organizationId: input.organizationId,
		...(input.surface === "team"
			? { expectedMemberRole: reviewedMemberRole }
			: {}),
	};
	const removeMutation = useMutation({
		mutationFn: async () => {
			const plan = removalPreview.data;
			if (!plan) {
				throw new Error("Review this member's Spaces before removing them.");
			}
			if (plan.spaces.length > 0 || input.surface === "team") {
				try {
					await prepareOrganizationMemberRemoval({
						memberId: plan.memberId,
						organizationId: input.organizationId,
						spaces: plan.spaces,
						...(plan.spaces.some((space) => space.action === "transfer")
							? {
									successorUserId,
									...(usesDefaultSuccessor
										? { useDefaultSuccessor: true as const }
										: {}),
								}
							: {}),
					});
				} catch (error) {
					throw memberRemovalPreparationError(plan.spaces.length > 0, error);
				}
			}
			try {
				await removeOrganizationMember(nativeRemoval);
			} catch (error) {
				if (plan.spaces.length > 0) {
					throw new Error(
						`The Space changes were saved, but member removal could not be confirmed. Refresh the members list before retrying. ${describeMemberRemovalError(error)}`
					);
				}
				throw error;
			}
		},
		onError: async (error) => {
			input.onError(error.message);
			setOpen(false);
			await queryClient.invalidateQueries(
				organizationDirectoryQueryFilters({
					organizationId: input.organizationId,
				})
			);
		},
		onSuccess: async () => {
			input.onError(null);
			await queryClient.invalidateQueries(
				organizationDirectoryQueryFilters({
					organizationId: input.organizationId,
				})
			);
			setOpen(false);
			input.onRemoved?.();
		},
	});

	const requiresSuccessor = removalPreview.data?.spaces.some(
		(space) => space.action === "transfer"
	);
	const successors = input.members.filter(
		(member) =>
			member.userId !== input.member.userId &&
			member.humanProfile?.status === "active"
	);
	const successor = successors.find(
		(member) => member.userId === successorUserId
	);

	return (
		<>
			<Button
				aria-label={`Remove ${memberName}`}
				disabled={input.disabled || removeMutation.isPending}
				onClick={() => {
					input.onStarted?.();
					removeMutation.reset();
					input.onError(null);
					setSelectedSuccessorUserId(null);
					setReviewedMemberRole(input.member.role);
					removalPreview.reset();
					removalPreview.mutate();
					setOpen(true);
				}}
				size="sm"
				type="button"
				variant={input.variant ?? "destructive"}
			>
				{input.label ?? "Remove"}
			</Button>
			<AlertDialog
				onOpenChange={(open) => {
					if (!removeMutation.isPending) {
						setOpen(open);
						if (!(open || removeMutation.isError)) {
							removeMutation.reset();
						}
					}
				}}
				open={open}
			>
				<AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
					<AlertDialogHeader>
						<AlertDialogTitle>Remove {memberName}?</AlertDialogTitle>
						<AlertDialogDescription>
							{input.surface === "team"
								? `${memberName} will lose access to this workspace. Shared work stays. Their Agents, computers, and personal channel connections aren’t transferred.`
								: `${memberName} will lose access to this organization. Review any Space changes before confirming removal.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					{input.surface === "team" ? null : (
						<p className="text-muted-foreground text-sm">
							Their Agents, computers, and connected channel accounts are not
							deleted or transferred by removing their membership. Shared work
							and organization channel connections stay in the workspace.
						</p>
					)}
					<OrganizationMemberRemovalReview
						disabled={removeMutation.isPending}
						error={removalPreview.error}
						isPending={removalPreview.isPending}
						onRetry={() => removalPreview.mutate()}
						onSuccessorChange={setSelectedSuccessorUserId}
						plan={removalPreview.data}
						successors={successors}
						successorUserId={successorUserId}
						usesDefaultSuccessor={usesDefaultSuccessor}
					/>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={removeMutation.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								removeMutation.isPending ||
								!removalPreview.isSuccess ||
								(requiresSuccessor && !(successor || usesDefaultSuccessor))
							}
							onClick={() => removeMutation.mutate()}
							type="button"
							variant="destructive"
						>
							{removeMutation.isPending ? "Removing" : "Remove member"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function memberRemovalPreparationError(
	hasSpaceChanges: boolean,
	error: unknown
) {
	const outcome = hasSpaceChanges
		? "Some Space changes may have been saved. Review the updated Spaces before retrying. "
		: "";
	return new Error(
		`The member was not removed. ${outcome}${describeMemberRemovalError(error)}`
	);
}

function describeMemberRemovalError(error: unknown): string {
	return error instanceof Error ? error.message : "Please try again.";
}

function OrganizationMemberRemovalReview(input: {
	disabled: boolean;
	error: Error | null;
	isPending: boolean;
	onRetry: () => void;
	onSuccessorChange: (userId: string) => void;
	plan: OrganizationMemberRemovalPlan | undefined;
	successorUserId: string;
	successors: readonly DirectoryMember[];
	usesDefaultSuccessor: boolean;
}) {
	if (input.isPending) {
		return (
			<output className="text-muted-foreground text-sm">
				Checking Space ownership…
			</output>
		);
	}
	if (input.error) {
		return (
			<div className="space-y-2">
				<p className="wrap-anywhere text-destructive text-sm" role="alert">
					{input.error.message}
				</p>
				<Button onClick={input.onRetry} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	if (!input.plan || input.plan.spaces.length === 0) {
		return null;
	}
	const defaultSuccessor = input.plan.defaultSuccessor;
	const successorOptions = input.successors.map((member) => ({
		userId: member.userId,
		name: member.humanProfile?.profileName ?? member.user.name,
	}));
	if (
		defaultSuccessor &&
		!successorOptions.some(
			(successor) => successor.userId === defaultSuccessor.userId
		)
	) {
		successorOptions.unshift({
			userId: defaultSuccessor.userId,
			name: defaultSuccessor.profileName,
		});
	}
	const successor = successorOptions.find(
		(member) => member.userId === input.successorUserId
	);
	return (
		<div className="space-y-3 text-sm">
			<ul aria-label="Space changes" className="space-y-2">
				{input.plan.spaces.map((space) => (
					<li className="wrap-anywhere" key={space.spaceId}>
						<p className="font-medium">{space.name}</p>
						<p className="text-muted-foreground text-xs">
							{SPACE_REMOVAL_ACTION_DESCRIPTIONS[space.action]}
						</p>
					</li>
				))}
			</ul>
			{input.plan.spaces.some((space) => space.action === "transfer") ? (
				<div className="space-y-2">
					<Select
						disabled={input.disabled}
						onValueChange={input.onSuccessorChange}
						value={input.successorUserId}
					>
						<SelectTrigger
							aria-label="New Space owner"
							className="w-full"
							displayValue={successor?.name}
							placeholder="Choose a new Space owner"
						/>
						<SelectContent>
							{successorOptions.map((member, index) => (
								<SelectItem
									index={index}
									key={member.userId}
									value={member.userId}
								>
									{member.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">
						{input.usesDefaultSuccessor && defaultSuccessor
							? `${defaultSuccessor.profileName} is the organization’s default recipient and already has access to all Spaces listed for transfer. Confirm to give them ownership.`
							: "The new owner gains access to the history and files of any transferred Spaces they do not already belong to, including private content. You only gain access if you select yourself."}
					</p>
					{successorOptions.length === 0 ? (
						<p className="text-destructive text-xs" role="alert">
							No other member has an active Human Profile. Add or enable a
							teammate before transferring these Spaces.
						</p>
					) : null}
				</div>
			) : null}
			<p className="text-muted-foreground text-xs">
				Space changes are saved before membership is removed. If removal fails,
				those changes remain.
			</p>
		</div>
	);
}

"use client";

import { Button } from "@openmeld/ui/components/button";
import { ChatCircleTextIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { DirectoryHumanProfileAvatar } from "#/components/directory/directory-human-profile-avatar";
import { resolveDirectoryEmailLabel } from "#/components/directory/directory-human-profile-format";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { DirectoryHumanProfileRoleBadge } from "#/components/directory/directory-human-profile-role-badge";
import { HumanProfileNameEditor } from "#/components/profiles/human-profile-name-editor";

export type DirectoryHumanProfileDetailsProps = {
	directMessageEnabled?: boolean;
	directMessageIsPending: boolean;
	editing: boolean;
	localAgentsContent?: ReactNode;
	activityContent?: ReactNode;
	member: DirectoryHumanProfileRow;
	onEditingChange: (editing: boolean) => void;
	onOpenDirectMessage: () => void;
};

export function DirectoryHumanProfileDetails(
	input: DirectoryHumanProfileDetailsProps
) {
	const canOpenDirectMessage =
		input.directMessageEnabled !== false &&
		input.member.profileStatus === "active" &&
		!input.member.isCurrentUser;
	return (
		<div
			className="@container/profile-detail mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
			data-testid="human-profile-details"
		>
			<ProfileHero
				canOpenDirectMessage={canOpenDirectMessage}
				directMessageIsPending={input.directMessageIsPending}
				editing={input.editing}
				member={input.member}
				onEditingChange={input.onEditingChange}
				onOpenDirectMessage={input.onOpenDirectMessage}
			/>
			{input.member.notice ? (
				<output className="block rounded-md border border-border bg-muted/35 px-4 py-3 text-muted-foreground text-sm">
					{input.member.notice}
				</output>
			) : null}

			{input.localAgentsContent}
			{input.activityContent}
		</div>
	);
}

function ProfileActions(input: {
	canEdit: boolean;
	canOpenDirectMessage: boolean;
	directMessageLabel: string;
	directMessageIsPending: boolean;
	onEdit: () => void;
	onOpenDirectMessage: () => void;
}) {
	if (!(input.canEdit || input.canOpenDirectMessage)) {
		return null;
	}
	return (
		<div
			className="flex max-w-full shrink-0 flex-wrap items-center gap-2"
			data-testid="human-profile-header-actions"
		>
			{input.canOpenDirectMessage ? (
				<Button
					aria-label={input.directMessageLabel}
					className="max-w-full"
					disabled={input.directMessageIsPending}
					onClick={input.onOpenDirectMessage}
					size="sm"
					type="button"
					variant="ghost"
				>
					<ChatCircleTextIcon aria-hidden="true" data-icon="inline-start" />
					Chat
				</Button>
			) : null}
			{input.canEdit ? (
				<Button onClick={input.onEdit} size="sm" type="button" variant="ghost">
					<PencilSimpleIcon aria-hidden="true" data-icon="inline-start" />
					Edit profile
				</Button>
			) : null}
		</div>
	);
}

function ProfileHero(input: {
	canOpenDirectMessage: boolean;
	directMessageIsPending: boolean;
	editing: boolean;
	member: DirectoryHumanProfileRow;
	onEditingChange: (editing: boolean) => void;
	onOpenDirectMessage: () => void;
}) {
	return (
		<div
			className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
			data-testid="human-profile-hero"
		>
			<div className="flex min-w-52 flex-1 items-center gap-3">
				<DirectoryHumanProfileAvatar context="detail" member={input.member} />
				<div className="min-w-0 flex-1 pt-1">
					{input.editing ? (
						<HumanProfileNameEditor
							onCancel={() => input.onEditingChange(false)}
							onSaved={() => input.onEditingChange(false)}
							profileName={input.member.name}
						/>
					) : (
						<div className="flex min-w-0 items-start gap-2">
							<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
								<h2 className="select-text break-words font-semibold text-xl leading-7">
									{input.member.name}
									{input.member.isCurrentUser ? " (you)" : ""}
								</h2>
								<DirectoryHumanProfileRoleBadge role={input.member.role} />
							</div>
						</div>
					)}
					<p
						className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm"
						data-testid="human-profile-metadata"
					>
						<span className="select-text break-all">
							{resolveDirectoryEmailLabel(input.member.email)}
						</span>
					</p>
				</div>
			</div>
			<ProfileActions
				canEdit={!input.editing && input.member.canEdit}
				canOpenDirectMessage={input.canOpenDirectMessage}
				directMessageIsPending={input.directMessageIsPending}
				directMessageLabel={`Chat with ${input.member.name}`}
				onEdit={() => input.onEditingChange(true)}
				onOpenDirectMessage={input.onOpenDirectMessage}
			/>
		</div>
	);
}

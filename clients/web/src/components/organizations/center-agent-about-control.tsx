"use client";

import { Popover } from "@base-ui/react/popover";
import { Button } from "@openmeld/ui/components/button";
import { InfoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { buildOrganizationCenterAgentSettingsPath } from "#/lib/organizations/organization-routes";
import {
	centerAgentDesignationQueryOptions,
	centerAgentModelQueryOptions,
} from "#/query/organizations/center-agent";
import {
	organizationDirectoryQueryOptions,
	organizationMemberRoleQueryOptions,
} from "#/query/organizations/organization-directory";
import {
	type DirectoryAgentProfile,
	resolveCenterAgentConnectionStatus,
	resolveDesignatedCenterAgentProfile,
} from "./center-agent-profile-presentation";

export function CenterAgentAboutControl(input: {
	organizationId: string;
	organizationSlug: string;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const designationQuery = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const modelQuery = useQuery(
		centerAgentModelQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: currentOrganization.isPersonal !== true,
			organizationId: input.organizationId,
			userId: currentUserId,
		})
	);
	const profile = resolveDesignatedCenterAgentProfile({
		agentProfiles: directoryQuery.data?.agentProfiles ?? [],
		designation: designationQuery.data?.designation ?? null,
	});

	return (
		<CenterAgentAboutPopover
			canManage={
				currentOrganization.isPersonal === true ||
				canManageOrganizationArea(roleQuery.data, {
					centerAgent: ["update"],
				})
			}
			isLoading={
				directoryQuery.isPending ||
				designationQuery.isPending ||
				modelQuery.isPending
			}
			modelDisplayName={modelQuery.data?.effectiveModel.displayName ?? null}
			organizationSlug={input.organizationSlug}
			profile={profile}
		/>
	);
}

export function CenterAgentAboutPopover(input: {
	canManage: boolean;
	isLoading?: boolean;
	modelDisplayName: string | null;
	organizationSlug: string;
	profile: DirectoryAgentProfile | null;
}) {
	const displayName = input.profile?.profileName ?? "Center Agent";
	const unavailableLabel = input.isLoading ? "Loading…" : "Unavailable";
	const facts = [
		{ label: "Display name", value: displayName },
		{
			label: "Handle",
			value: input.profile
				? `@${input.profile.profileHandle}`
				: unavailableLabel,
		},
		{
			label: "Model",
			value: input.modelDisplayName ?? unavailableLabel,
		},
		{
			label: "Connection",
			value: input.profile
				? resolveCenterAgentConnectionStatus(input.profile)
				: unavailableLabel,
		},
	] as const;

	return (
		<Popover.Root modal={false}>
			<Popover.Trigger
				render={<Button size="sm" type="button" variant="ghost" />}
			>
				<InfoIcon aria-hidden="true" data-icon="inline-start" />
				About
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					align="end"
					className="z-50"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "start",
						side: "flip",
					}}
					collisionPadding={12}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						className="w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none"
						finalFocus={false}
					>
						<div className="space-y-4">
							<div>
								<p className="font-medium text-foreground text-sm">
									About the Center Agent
								</p>
								<p className="mt-1 text-muted-foreground text-xs leading-5">
									Your workspace coordinator and its current connection.
								</p>
							</div>
							<dl className="space-y-3">
								{facts.map((fact) => (
									<div
										className="grid grid-cols-[5.5rem_1fr] gap-3"
										key={fact.label}
									>
										<dt className="text-muted-foreground text-xs">
											{fact.label}
										</dt>
										<dd className="min-w-0 break-words text-foreground text-xs">
											{fact.value}
										</dd>
									</div>
								))}
							</dl>
							{input.canManage ? (
								<div className="border-border border-t pt-3">
									<Link
										className="font-medium text-foreground text-xs underline-offset-4 hover:underline"
										to={buildOrganizationCenterAgentSettingsPath(
											input.organizationSlug
										)}
									>
										Manage →
									</Link>
								</div>
							) : null}
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

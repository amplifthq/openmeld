"use client";

import { useQuery } from "@tanstack/react-query";
import { OrganizationInboxPreview } from "#/components/inbox/organization-inbox-preview";
import { StaleDataNotice } from "#/components/stale-data-notice";
import { buildOrganizationInboxPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { inboxSummaryQueryOptions } from "#/query/organizations/inbox";
import { OrganizationHomePanel } from "./organization-home-ui";

export function OrganizationHomeInbox(input: {
	currentOrganization: OrganizationSummary;
}) {
	const summaryQuery = useQuery(
		inboxSummaryQueryOptions({
			organizationId: input.currentOrganization.id,
		})
	);
	const status = resolveInboxStatus({
		isError: summaryQuery.isError,
		isPending: summaryQuery.isPending,
		totalUnreadCount: summaryQuery.data?.totalUnreadCount ?? 0,
		unresolvedActionCount: summaryQuery.data?.unresolvedActionCount ?? 0,
	});

	return (
		<OrganizationHomePanel
			className="overflow-hidden"
			href={buildOrganizationInboxPath(input.currentOrganization.slug)}
			status={status}
			title="Inbox"
		>
			{summaryQuery.isError ? (
				<StaleDataNotice
					label="Inbox may be out of date."
					onRetry={() => summaryQuery.refetch()}
				/>
			) : null}
			<div
				className="max-h-80 overflow-y-auto overscroll-contain"
				data-testid="home-inbox-preview"
			>
				<OrganizationInboxPreview
					actionLimit={2}
					currentOrganization={input.currentOrganization}
					itemLimit={4}
				/>
			</div>
		</OrganizationHomePanel>
	);
}

function resolveInboxStatus(input: {
	isError: boolean;
	isPending: boolean;
	totalUnreadCount: number;
	unresolvedActionCount: number;
}): string | undefined {
	if (input.isError) {
		return "Unavailable";
	}
	if (input.isPending) {
		return "Checking…";
	}
	if (input.unresolvedActionCount > 0) {
		return `${String(input.unresolvedActionCount)} need action`;
	}
	if (input.totalUnreadCount > 0) {
		return `${String(input.totalUnreadCount)} unread`;
	}
	return undefined;
}

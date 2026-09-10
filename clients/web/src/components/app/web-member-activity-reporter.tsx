import type {
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { recordCurrentOrganizationWebActivity } from "#/lib/organizations/organization-member-activity";
import {
	memberPresenceQueryKey,
	recordCurrentOrganizationMemberPresence,
} from "#/lib/organizations/organization-member-presence";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startWebMemberPresenceSession } from "./web-member-presence-session";

const WEB_MEMBER_ACTIVITY_INTERVAL_MS = 5 * 60_000;

export function WebMemberActivityReporter(input: {
	currentUserId: string;
	organizationId: string;
	spaceId?: string;
}) {
	const queryClient = useQueryClient();
	const lastSuccessfulReportAtRef = useRef<number | null>(null);

	useEffect(() => {
		let disposed = false;
		let reportInFlight = false;
		lastSuccessfulReportAtRef.current = null;

		const report = async () => {
			if (disposed || reportInFlight || document.visibilityState === "hidden") {
				return;
			}
			const nowMs = Date.now();
			if (
				lastSuccessfulReportAtRef.current !== null &&
				nowMs - lastSuccessfulReportAtRef.current <
					WEB_MEMBER_ACTIVITY_INTERVAL_MS
			) {
				return;
			}
			reportInFlight = true;
			try {
				const activity = await recordCurrentOrganizationWebActivity({
					organizationId: input.organizationId,
					...(input.spaceId ? { spaceId: input.spaceId } : {}),
				});
				if (
					activity.organizationId !== input.organizationId ||
					activity.userId !== input.currentUserId
				) {
					throw new Error(
						"Member activity resolved for a different Organization or user."
					);
				}
				lastSuccessfulReportAtRef.current = Date.now();
				queryClient.setQueryData<OrganizationDirectoryResponse>(
					organizationQueryKeys.directory(input.organizationId),
					(current) =>
						current
							? {
									...current,
									members: current.members.map((member) =>
										member.userId === input.currentUserId
											? {
													...member,
													lastActiveAt: activity.lastActiveAt,
												}
											: member
									),
								}
							: current
				);
				queryClient.setQueryData<OrganizationProfileDirectoryResponse>(
					organizationQueryKeys.profileDirectory(input.organizationId),
					(current) =>
						current
							? {
									...current,
									members: current.members.map((member) =>
										member.userId === input.currentUserId
											? {
													...member,
													lastActiveAt: activity.lastActiveAt,
												}
											: member
									),
								}
							: current
				);
			} finally {
				reportInFlight = false;
			}
		};
		const requestReport = () => {
			report().catch((error: unknown) => {
				console.warn("[openmeld.web.member_activity.record_failed]", {
					error: error instanceof Error ? error.message : String(error),
					organizationId: input.organizationId,
				});
			});
		};

		const stopPresence = startWebMemberPresenceSession((body) => {
			if (body.interaction) {
				requestReport();
			}
			recordCurrentOrganizationMemberPresence(input.organizationId, body)
				.then((result) => {
					if (
						result.organizationId !== input.organizationId ||
						result.userId !== input.currentUserId
					) {
						throw new Error("Member presence resolved for another user.");
					}
					if (!disposed) {
						return queryClient.invalidateQueries({
							queryKey: memberPresenceQueryKey(input.organizationId),
						});
					}
				})
				.catch((error: unknown) =>
					console.warn("[openmeld.web.member_presence.record_failed]", {
						error: error instanceof Error ? error.message : String(error),
					})
				);
		});
		return () => {
			disposed = true;
			stopPresence();
		};
	}, [input.currentUserId, input.organizationId, input.spaceId, queryClient]);

	return null;
}

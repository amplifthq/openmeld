import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { recordCurrentOrganizationWebActivity } from "#/lib/organizations/organization-member-activity";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";

const WEB_MEMBER_ACTIVITY_INTERVAL_MS = 5 * 60_000;

export function WebMemberActivityReporter(input: {
	currentUserId: string;
	organizationId: string;
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

		const reportWhenVisible = () => {
			if (document.visibilityState !== "hidden") {
				requestReport();
			}
		};

		requestReport();
		const intervalId = window.setInterval(
			reportWhenVisible,
			WEB_MEMBER_ACTIVITY_INTERVAL_MS
		);
		window.addEventListener("focus", reportWhenVisible);
		document.addEventListener("visibilitychange", reportWhenVisible);
		return () => {
			disposed = true;
			window.clearInterval(intervalId);
			window.removeEventListener("focus", reportWhenVisible);
			document.removeEventListener("visibilitychange", reportWhenVisible);
		};
	}, [input.currentUserId, input.organizationId, queryClient]);

	return null;
}

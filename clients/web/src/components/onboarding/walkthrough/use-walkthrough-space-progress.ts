import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { SpaceLandingController } from "#/components/spaces/use-space-landing-controller";
import { buildWelcomeSpaceDraft } from "#/components/spaces/welcome-space-state";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";
import { useWalkthrough } from "./walkthrough-context";
import { hasTutorialReply } from "./walkthrough-reply";

export function useWalkthroughSpaceProgress(
	spaceId: string,
	controller: SpaceLandingController
) {
	const guide = useWalkthrough();
	const record = guide?.record;
	const { currentOrganization, currentUserId } = useAppOrganization();
	const enabled = Boolean(
		record && record.spaceId === spaceId && !record.paused
	);
	const designation = useQuery(
		centerAgentDesignationQueryOptions({
			enabled,
			organizationId: currentOrganization.id,
		})
	);
	const centerId = designation.data?.designation?.agentProfileId;
	const members =
		controller.mode === "ready"
			? controller.membersSnapshot?.agents
			: undefined;
	const center = members?.find(
		(agent) => agent.profileId === centerId && agent.status === "active"
	);
	const local = members?.find((agent) => {
		const kind = parseAgentControllerRef(agent.agentControllerRef)?.kind;
		return (
			(kind === "builtin" || kind === "custom") &&
			agent.ownerUserId === currentUserId &&
			agent.status === "active"
		);
	});
	const items = controller.mode === "ready" ? controller.timelineItems : [];
	const sentTo = (id: string | undefined) =>
		Boolean(
			id &&
				items.some(
					(item) =>
						item.actorProfileId === record?.profileId &&
						item.deliveryState === "sent" &&
						item.wakeTargetProfileIds.includes(id)
				)
		);
	const repliedTo = (id: string | undefined) =>
		Boolean(
			id &&
				record &&
				hasTutorialReply({ items, centerId: id, profileId: record.profileId })
		);
	const centerSent = sentTo(centerId);
	const localSent = sentTo(local?.profileId);
	const recipient = record?.step === "local-task" ? local : center;
	const sent = record?.step === "local-task" ? localSent : centerSent;
	const seeded = useRef("");
	useEffect(() => {
		if (
			!(
				enabled &&
				record &&
				(record.step === "first-task" || record.step === "local-task") &&
				recipient
			) ||
			controller.mode !== "ready" ||
			controller.historyIsPending ||
			controller.historyError ||
			controller.isMembersLoading ||
			controller.isSendingMessage
		) {
			return;
		}
		const key = `${record.runId}:${recipient.profileId}`;
		if (seeded.current === key || sent) {
			return;
		}
		// Never replace a person's draft, attachment, or reply. Seeding is not Send.
		if (
			controller.composerText.trim() ||
			controller.composerFiles.length ||
			controller.composerReplyToSignalId
		) {
			return;
		}
		seeded.current = key;
		controller.onComposerEditorChange(
			buildWelcomeSpaceDraft(
				[
					{
						profileId: recipient.profileId,
						profileName: recipient.profileName,
						profileKind: "agent",
					},
				],
				"Hi! In two short sentences, introduce yourself and tell me one thing you can help me do in this Space."
			)
		);
	}, [enabled, record, recipient, controller, sent]);
	const attempted = useRef("");
	useEffect(() => {
		if (!(enabled && guide && record) || guide.pending) {
			return;
		}
		let next: "first-task" | "local-agent" | "local-task" | null = null;
		if (record.step === "add-center-agent" && center) {
			next = "first-task";
		}
		if (record.step === "first-task" && centerSent) {
			next = "local-agent";
		}
		if (record.step === "add-local-agent" && local) {
			next = "local-task";
		}
		if (!next) {
			return;
		}
		const key = `${record.runId}:${record.revision}:${next}`;
		if (attempted.current === key) {
			return;
		}
		attempted.current = key;
		guide.progress(next).catch(() => undefined);
	}, [enabled, guide, record, center, centerSent, local]);
	return {
		centerSent,
		localSent,
		centerReplied: repliedTo(centerId),
		localReplied: repliedTo(local?.profileId),
		local,
		recipient,
	};
}

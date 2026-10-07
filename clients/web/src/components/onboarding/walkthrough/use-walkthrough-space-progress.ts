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
	const attempted = useRef("");
	const seededRun = useRef("");
	useEffect(() => {
		if (
			!enabled ||
			record?.step !== "first-task" ||
			controller.mode !== "ready" ||
			controller.historyIsPending ||
			controller.historyError ||
			controller.isMembersLoading ||
			controller.isSendingMessage ||
			seededRun.current === record.runId
		) {
			return;
		}
		const center = controller.membersSnapshot?.agents.find(
			(agent) => agent.profileId === centerId && agent.status === "active"
		);
		if (!center) {
			return;
		}
		seededRun.current = record.runId;
		if (
			controller.composerText.trim() ||
			controller.composerFiles.length ||
			controller.composerReplyToSignalId ||
			controller.timelineItems.some(
				(item) => item.actorProfileId === record.profileId
			)
		) {
			return;
		}
		controller.onComposerEditorChange(
			buildWelcomeSpaceDraft([
				{
					profileId: center.profileId,
					profileName: center.profileName,
					profileKind: "agent",
				},
			])
		);
	}, [enabled, record, controller, centerId]);
	const centerJoined =
		controller.mode === "ready" &&
		Boolean(
			centerId &&
				controller.membersSnapshot?.agents.some(
					(agent) => agent.profileId === centerId && agent.status === "active"
				)
		);
	const ownAgentJoined =
		controller.mode === "ready" &&
		Boolean(
			controller.membersSnapshot?.agents.some((agent) => {
				const kind = parseAgentControllerRef(agent.agentControllerRef)?.kind;
				return (
					(kind === "builtin" || kind === "custom") &&
					agent.ownerUserId === currentUserId &&
					agent.status === "active"
				);
			})
		);
	const replied =
		controller.mode === "ready" &&
		Boolean(
			centerId &&
				record &&
				hasTutorialReply({
					items: controller.timelineItems,
					centerId,
					profileId: record.profileId,
				})
		);
	useEffect(() => {
		if (!(enabled && guide && record) || guide.pending) {
			return;
		}
		const completedSteps = {
			"add-center-agent": centerJoined ? ("first-task" as const) : null,
			"first-task": replied ? ("local-agent" as const) : null,
			"add-local-agent": ownAgentJoined ? ("options" as const) : null,
		};
		const next = completedSteps[record.step as keyof typeof completedSteps];
		if (!next) {
			return;
		}
		const key = `${record.runId}:${record.revision}:${next}`;
		if (attempted.current === key) {
			return;
		}
		attempted.current = key;
		guide.progress(next).catch(() => undefined);
	}, [enabled, guide, record, centerJoined, replied, ownAgentJoined]);
}

import { createSpaceMemberAgentSnapshot } from "@openmeld/schemas/testing";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useState } from "react";
import { AgentList } from "../../src/components/agents/agent-list";
import { buildAgentListItem } from "../../src/components/agents/agent-list-model";
import { AgentProfileSidebarItem } from "../../src/components/agents/agent-profile-sidebar-item";
import { AgentProfileWorkspaceDetail } from "../../src/components/agents/agent-profile-workspace-detail";

import { demoAgentProfiles as profiles } from "./demo-data";

const controller = (profile: AuthProfileView) =>
	profile.profileHandle === "codex" ? "builtin:codex" : "builtin:claude-code";
const items = profiles.map((profile) =>
	buildAgentListItem({ profile, agentControllerRef: controller(profile) })
);
export function DemoAgents() {
	const [selected, setSelected] = useState<AuthProfileView | null>(null);
	if (selected) {
		return (
			<>
				<Button onClick={() => setSelected(null)} size="sm" variant="ghost">
					All Agents
				</Button>
				<AgentProfileWorkspaceDetail
					activityNavigation={null}
					agentControllerRef={controller(selected)}
					canEdit={false}
					controllerModelSummary={`${selected.profileName} · Controller default`}
					details={{
						context: "account",
						profileId: selected.openMeldProfileId,
						profileKind: "agent",
						profileName: selected.profileName,
						viewerScope: "observer",
						sections: [],
					}}
					directMessageEnabled={false}
					isDirectMessagePending={false}
					isRecoveryActionPending={false}
					onOpenDirectMessage={() => undefined}
					onRenameProfile={async () => undefined}
					operationalContext={null}
					overflowActions={null}
					profile={selected}
					wakeAvailability={
						createSpaceMemberAgentSnapshot({
							profileId: selected.openMeldProfileId,
							profileName: selected.profileName,
							agentControllerRef: controller(selected),
							ownerName: "Maya Chen",
							ownerUserId: "preview",
						}).agentWakeAvailability ?? null
					}
					wakeAvailabilityCheckedAt={null}
					wakeAvailabilityErrorMessage={null}
					wakeAvailabilityIsPending={false}
					wakeAvailabilityIsRefreshing={false}
					wakeAvailabilityNowMs={1_791_334_800_000}
				/>
			</>
		);
	}
	return (
		<AgentList
			items={items}
			label="Maya Chen’s Agents"
			renderCard={(item, index) => (
				<AgentProfileSidebarItem
					agentControllerRef={controller(item.profile)}
					index={index}
					isActive={false}
					modelCatalog={null}
					onSelectProfile={(id) =>
						setSelected(
							profiles.find((p) => p.openMeldProfileId === id) ?? null
						)
					}
					operationalContext={null}
					profile={item.profile}
					readiness={null}
					readinessErrorMessage={null}
					readinessIsPending={false}
					variant="card"
				/>
			)}
			viewPreferenceKey="demo-agents"
		/>
	);
}

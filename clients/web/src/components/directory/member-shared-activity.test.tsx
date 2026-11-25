import type { AgentActivitySnapshotResponse } from "@openmeld/schemas/types";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemberSharedActivityReadout } from "./member-shared-activity";

afterEach(cleanup);

const now = 1_795_551_300_000;
const project = {
	id: "project-1",
	name: "Release checklist",
} as AgentActivitySnapshotResponse["projects"][number];
const session = {
	clientKind: "codex-cli",
	expiresAtMs: now + 60_000,
	gitBranch: null,
	gitCommit: null,
	id: "session-1",
	isActive: true,
	lastObservedAtMs: now - 1000,
	memberName: "Grace",
	memberUserId: "grace",
	model: null,
	projectId: project.id,
	provider: "codex",
	startedAtMs: null,
	status: "active",
	title: "Verify onboarding",
} satisfies AgentActivitySnapshotResponse["sessions"][number];
const snapshot = {
	asOfMs: now,
	digests: [],
	digestsTruncated: false,
	organizationId: "org",
	projects: [project],
	recentEvents: [],
	sessions: [],
	sessionsTruncated: false,
	stalenessThresholdMs: 30_000,
} satisfies AgentActivitySnapshotResponse;

it("shows only the subject's shared session, active focus and meaningful events", () => {
	render(
		<MemberSharedActivityReadout
			memberUserId="grace"
			nowMs={now}
			snapshot={{
				...snapshot,
				sessions: [
					session,
					{
						...session,
						id: "other",
						title: "Another member's session",
						memberUserId: "other",
					},
				],
				recentEvents: [
					{
						clientKind: "codex-cli",
						eventId: "finished",
						eventType: "session_ended",
						memberName: "Grace",
						memberUserId: "grace",
						observedAtMs: now - 15_000,
						projectId: project.id,
						provider: "codex",
						status: "ended",
						title: "Polish checkout",
					},
					{
						clientKind: "codex-cli",
						eventId: "heartbeat",
						eventType: "heartbeat",
						memberName: "Grace",
						memberUserId: "grace",
						observedAtMs: now - 1000,
						projectId: project.id,
						provider: "codex",
						status: "active",
						title: "Heartbeat noise",
					},
				],
			}}
		/>
	);
	expect(
		within(screen.getByRole("region", { name: "Current focus" })).getByText(
			"Release checklist"
		)
	).toBeTruthy();
	expect(
		within(screen.getByRole("region", { name: "Recent sessions" })).getByText(
			"Verify onboarding"
		)
	).toBeTruthy();
	expect(
		within(screen.getByRole("region", { name: "Activity" })).getByText(
			"Polish checkout"
		)
	).toBeTruthy();
	expect(screen.queryByText("Another member's session")).toBeNull();
	expect(screen.queryByText("Heartbeat noise")).toBeNull();
});

it("never presents expired or stale activity as current focus", () => {
	render(
		<MemberSharedActivityReadout
			memberUserId="grace"
			nowMs={now}
			snapshot={{
				...snapshot,
				sessions: [
					{ ...session, expiresAtMs: now },
					{ ...session, id: "stale", lastObservedAtMs: now - 31_000 },
				],
			}}
		/>
	);
	expect(screen.queryByRole("region", { name: "Current focus" })).toBeNull();
	expect(screen.getByRole("region", { name: "Recent sessions" })).toBeTruthy();
	expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
});

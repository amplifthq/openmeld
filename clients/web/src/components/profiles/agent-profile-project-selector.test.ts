import { describe, expect, it } from "vitest";
import type { ProjectComputerView } from "#/components/projects/use-project-discovery";
import {
	resolveAgentProfileProjectCandidate,
	resolveAgentProfileProjectSelectorBranch,
} from "./agent-profile-project-selector-state";

describe("Agent Profile Project selector", () => {
	it("resolves one available connection as the default working folder", () => {
		expect(
			resolveAgentProfileProjectSelectorBranch(
				view({
					connections: [connection("binding-1", "/repo", true)],
				})
			)
		).toBe("connected");
	});

	it("offers candidate connection when discovery finds a repository", () => {
		expect(
			resolveAgentProfileProjectSelectorBranch(
				view({
					candidates: [
						{
							candidateId: "candidate-1",
							candidateKind: "repository",
							canonicalPath: "/repo",
							repositoryFingerprint: `sha256:${"a".repeat(64)}`,
						},
					],
					status: "found",
				})
			)
		).toBe("candidate");
	});

	it("requires a deterministic choice when multiple connections are available", () => {
		expect(
			resolveAgentProfileProjectSelectorBranch(
				view({
					connections: [
						connection("binding-1", "/repo", true),
						connection("binding-2", "/repo-worktree", false),
					],
				})
			)
		).toBe("multiple_connections");
	});

	it("requires an explicit replacement when the saved default is missing", () => {
		expect(
			resolveAgentProfileProjectSelectorBranch(
				view({
					connections: [
						{
							...connection("binding-missing", "/repo", true),
							status: "missing",
						},
						connection("binding-healthy", "/repo-worktree", false),
					],
					status: "connected_folder_missing",
				})
			)
		).toBe("multiple_connections");
	});

	it.each([
		["checking", "checking"],
		["service_unavailable", "service_unavailable"],
	] as const)("keeps %s distinct from not found", (status, expected) => {
		expect(
			resolveAgentProfileProjectSelectorBranch({
				connections: [],
				discovery: null,
				errorMessage: null,
				status,
			})
		).toBe(expected);
	});

	it("keeps Git verification failure distinct from not found", () => {
		expect(
			resolveAgentProfileProjectSelectorBranch(
				view({ status: "verification_unavailable" })
			)
		).toBe("verification_unavailable");
	});

	it("requires a deterministic candidate choice when discovery finds several folders", () => {
		const candidates = [
			candidate("candidate-1", "/repo"),
			candidate("candidate-2", "/repo-worktree"),
		];
		expect(resolveAgentProfileProjectCandidate(candidates, null)).toBeNull();
		expect(
			resolveAgentProfileProjectCandidate(candidates, "candidate-2")
		).toEqual(candidates[1]);
	});

	it("offers explicit workspace fallbacks when no folder or candidate exists", () => {
		expect(resolveAgentProfileProjectSelectorBranch(view())).toBe(
			"no_candidate"
		);
	});
});

function connection(
	bindingGeneration: string,
	path: string,
	isDefault: boolean
) {
	return {
		bindingGeneration,
		isDefault,
		path,
		status: "available" as const,
	};
}

function candidate(candidateId: string, canonicalPath: string) {
	return {
		candidateId,
		candidateKind: "repository" as const,
		canonicalPath,
		repositoryFingerprint: `sha256:${"a".repeat(64)}` as const,
	};
}

function view(input?: {
	candidates?: NonNullable<ProjectComputerView["discovery"]>["candidates"];
	connections?: ProjectComputerView["connections"];
	status?: NonNullable<ProjectComputerView["discovery"]>["status"];
}): ProjectComputerView {
	const connections = input?.connections ?? [];
	const candidates = input?.candidates ?? [];
	return {
		connections,
		discovery: {
			candidates,
			connections: [...connections],
			projectId: "project-1",
			status: input?.status ?? "not_found",
		},
		errorMessage: null,
		status: "ready",
	};
}

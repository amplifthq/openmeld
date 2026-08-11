import type { LocalProjectControlCandidate } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectCandidatePicker } from "./project-candidate-picker";

afterEach(cleanup);

describe("ProjectCandidatePicker", () => {
	it("supports one selected folder with Fluid radio controls", () => {
		const onSelectionChange = vi.fn();
		render(
			<CandidatePickerHarness
				onSelectionChange={onSelectionChange}
				selectionMode="single"
			/>
		);

		expect(screen.getAllByRole("radio")).toHaveLength(2);
		fireEvent.click(
			screen.getByRole("radio", { name: "/work/openmeld-feature" })
		);

		expect(onSelectionChange).toHaveBeenLastCalledWith(
			new Set(["candidate-worktree"])
		);
	});

	it("supports multiple selected folders with Fluid checkbox controls", () => {
		const onSelectionChange = vi.fn();
		render(
			<CandidatePickerHarness
				onSelectionChange={onSelectionChange}
				selectionMode="multiple"
			/>
		);

		expect(screen.getAllByRole("checkbox")).toHaveLength(2);
		fireEvent.click(screen.getByRole("checkbox", { name: "/work/openmeld" }));
		fireEvent.click(
			screen.getByRole("checkbox", { name: "/work/openmeld-feature" })
		);

		expect(onSelectionChange).toHaveBeenLastCalledWith(
			new Set(["candidate-repository", "candidate-worktree"])
		);
	});

	it("does not allow a stale candidate selection during a background check", () => {
		const onSelectionChange = vi.fn();
		render(
			<ProjectCandidatePicker
				candidates={candidates}
				disabled
				onSelectionChange={onSelectionChange}
				selectedCandidateIds={new Set()}
				selectionMode="multiple"
			/>
		);

		const candidate = screen.getByRole("checkbox", { name: "/work/openmeld" });
		expect(candidate.getAttribute("aria-disabled")).toBe("true");
		fireEvent.click(candidate);
		expect(onSelectionChange).not.toHaveBeenCalled();
	});
});

function CandidatePickerHarness(input: {
	onSelectionChange: (candidateIds: ReadonlySet<string>) => void;
	selectionMode: "multiple" | "single";
}) {
	const [selectedCandidateIds, setSelectedCandidateIds] = useState<
		ReadonlySet<string>
	>(new Set());
	return (
		<ProjectCandidatePicker
			candidates={candidates}
			onSelectionChange={(candidateIds) => {
				setSelectedCandidateIds(candidateIds);
				input.onSelectionChange(candidateIds);
			}}
			selectedCandidateIds={selectedCandidateIds}
			selectionMode={input.selectionMode}
		/>
	);
}

const candidates: readonly LocalProjectControlCandidate[] = [
	{
		candidateId: "candidate-repository",
		candidateKind: "repository",
		canonicalPath: "/work/openmeld",
		repositoryFingerprint: `sha256:${"a".repeat(64)}`,
	},
	{
		candidateId: "candidate-worktree",
		candidateKind: "worktree",
		canonicalPath: "/work/openmeld-feature",
		repositoryFingerprint: `sha256:${"a".repeat(64)}`,
	},
];

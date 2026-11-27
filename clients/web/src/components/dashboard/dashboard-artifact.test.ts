import { describe, expect, it } from "vitest";
import {
	buildDashboardArtifactLink,
	parseDashboardArtifactLink,
} from "./dashboard-artifact";

const origin = "https://app.openmeld.ai";
const artifact = { spaceId: "space_1", fileId: "file-2", revision: 3 };
const path = buildDashboardArtifactLink(artifact, "sample");

describe("Dashboard artifact links", () => {
	it("keeps only the exact artifact revision without a supplied profile identity", () => {
		expect(
			parseDashboardArtifactLink(
				`${origin}${path}&profileId=someone-else`,
				"sample",
				origin
			)
		).toEqual(artifact);
		expect(parseDashboardArtifactLink(path, "sample", origin)).toEqual(
			artifact
		);
	});

	it("rejects other origins, workspaces, routes and invalid revisions", () => {
		for (const link of [
			`https://example.test${path}`,
			`//app.openmeld.ai${path}`,
			path.replace("organizationSlug=sample", "organizationSlug=other"),
			path.replace("/file-preview", "/files"),
			path.replace("revision=3", "revision=3.5"),
			"javascript:alert(1)",
		]) {
			expect(parseDashboardArtifactLink(link, "sample", origin)).toBeNull();
		}
	});
});

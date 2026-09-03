import { describe, expect, it } from "vitest";
import { resolveLocalProjectControlErrorMessage } from "./local-project-control";

describe("resolveLocalProjectControlErrorMessage", () => {
	it.each([
		[
			"path_not_found",
			"OpenMeld couldn’t find that folder on this computer. Check the path and try again.",
		],
		[
			"path_not_directory",
			"That path is not a folder. Enter the Project’s folder path.",
		],
		[
			"path_unreadable",
			"OpenMeld can’t read that folder. Check its permissions and try again.",
		],
		[
			"git_repository_required",
			"This Project has a saved repository identity, but this folder is not a Git repository.",
		],
		[
			"fingerprint_mismatch",
			"This folder belongs to a different Git repository. Choose the folder that matches this Project.",
		],
		[
			"git_unavailable",
			"OpenMeld can’t verify this repository because Git tools aren’t available on this computer. Install Git tools, then try again.",
		],
		[
			"command_line_tools_missing",
			"OpenMeld can’t verify this repository because Git tools aren’t available on this computer. Install Git tools, then try again.",
		],
		[
			"service_offline",
			"This computer isn't connected to OpenMeld right now. Reconnect it, then try again.",
		],
		[
			"service_update_required",
			"Update OpenMeld on this computer before connecting Project folders from the Web.",
		],
		["timeout", "This computer didn’t finish checking the folder. Try again."],
	] as const)("maps %s to the approved Connect folder copy", (code, expected) => {
		expect(resolveLocalProjectControlErrorMessage(failure(code))).toBe(
			expected
		);
	});

	it("replaces legacy workspace conflict copy with actionable Project language", () => {
		const message =
			"This folder is already connected to “other-project” in another workspace. Disconnect it there before using it for this Project.";
		expect(
			resolveLocalProjectControlErrorMessage(failure("path_conflict", message))
		).toBe(
			"This folder is already connected to another Project on this computer. Update OpenMeld, then try again to review the impact and move it here."
		);
	});
});

function failure(code: string, message = "local Project control failed") {
	return {
		code: "gateway.upstream_error",
		message,
		requestId: "request-1",
		status: 409,
		upstreamCode: code,
	};
}

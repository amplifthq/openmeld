import type {
	LocalCliComponentUpdateProjection,
	LocalServiceComponentUpdateProjection,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	formatServiceUpdateVerificationFailureDetail,
	formatServiceUpdateVerificationSuccessDetail,
	isServiceUpdateStillRequired,
	resolveServiceUpdateVerificationState,
	SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE,
} from "./service-update-verification";

const TIMEOUT_MS = 60_000;

describe("resolveServiceUpdateVerificationState", () => {
	it("is not_applicable for plain setup mode even when the projection is behind", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection(),
				elapsedSinceCompletionMs: 1000,
				mode: "setup",
				service: buildServiceProjection({
					status: "update_required",
					wakeBlocked: true,
				}),
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "not_applicable" });
	});

	it("is not_applicable before the terminal session has completed", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection(),
				elapsedSinceCompletionMs: null,
				mode: "update_service",
				service: buildServiceProjection({
					status: "update_required",
					wakeBlocked: true,
				}),
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "not_applicable" });
	});

	it("keeps confirming while the service projection is still update_required within the timeout window", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection(),
				elapsedSinceCompletionMs: TIMEOUT_MS - 1,
				mode: "update_service",
				service: buildServiceProjection({
					status: "update_required",
					wakeBlocked: true,
				}),
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "confirming" });
	});

	it("keeps confirming while only the CLI projection is still update_required", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection({ status: "update_required" }),
				elapsedSinceCompletionMs: 5000,
				mode: "update_service",
				service: buildServiceProjection(),
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "confirming" });
	});

	it("confirms once both service and CLI projections clear update_required", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection(),
				elapsedSinceCompletionMs: 5000,
				mode: "update_service",
				service: buildServiceProjection(),
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "confirmed" });
	});

	it("is confirming, not confirmed, when neither projection has arrived yet (query cold start)", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: undefined,
				elapsedSinceCompletionMs: 0,
				mode: "update_service",
				service: undefined,
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "confirming" });
	});

	it("is confirming, not confirmed, when only the service projection has arrived", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: null,
				elapsedSinceCompletionMs: 1000,
				mode: "update_service",
				service: buildServiceProjection(),
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "confirming" });
	});

	it("is confirming, not confirmed, when only the CLI projection has arrived", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection(),
				elapsedSinceCompletionMs: 1000,
				mode: "update_service",
				service: null,
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "confirming" });
	});

	it("times out when neither projection ever arrives within the timeout window", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: undefined,
				elapsedSinceCompletionMs: TIMEOUT_MS,
				mode: "update_service",
				service: undefined,
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ cli: null, service: null, status: "timed_out" });
	});

	it("confirms once both projections arrive and clear update_required, even past the timeout window", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection(),
				elapsedSinceCompletionMs: TIMEOUT_MS + 5000,
				mode: "update_service",
				service: buildServiceProjection(),
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "confirmed" });
	});

	it("times out when the service projection is still update_required past the timeout window", () => {
		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection(),
				elapsedSinceCompletionMs: TIMEOUT_MS,
				mode: "update_service",
				service: buildServiceProjection({
					status: "update_required",
					wakeBlocked: true,
				}),
				timeoutMs: TIMEOUT_MS,
			})
		).toMatchObject({ status: "timed_out" });
	});

	it("reports the fresh projection data alongside a timed_out status", () => {
		const service = buildServiceProjection({
			installedVersion: "0.2.20",
			requiredVersion: "0.2.21",
			status: "update_required",
			wakeBlocked: true,
		});

		expect(
			resolveServiceUpdateVerificationState({
				cli: buildCliProjection(),
				elapsedSinceCompletionMs: TIMEOUT_MS,
				mode: "update_service",
				service,
				timeoutMs: TIMEOUT_MS,
			})
		).toEqual({
			cli: buildCliProjection(),
			service,
			status: "timed_out",
		});
	});
});

describe("isServiceUpdateStillRequired", () => {
	it("is still required when neither projection has arrived yet (query cold start)", () => {
		expect(isServiceUpdateStillRequired(undefined, undefined)).toBe(true);
	});

	it("is still required when only one of the two projections has arrived", () => {
		expect(isServiceUpdateStillRequired(buildCliProjection(), null)).toBe(true);
		expect(isServiceUpdateStillRequired(null, buildServiceProjection())).toBe(
			true
		);
	});

	it("is still required when both projections arrived but one is update_required", () => {
		expect(
			isServiceUpdateStillRequired(
				buildCliProjection({ status: "update_required" }),
				buildServiceProjection()
			)
		).toBe(true);
	});

	it("is not required once both projections arrive and clear update_required", () => {
		expect(
			isServiceUpdateStillRequired(
				buildCliProjection(),
				buildServiceProjection()
			)
		).toBe(false);
	});
});

describe("formatServiceUpdateVerificationFailureDetail", () => {
	it("names the installed and required OpenMeld Service versions", () => {
		const detail = formatServiceUpdateVerificationFailureDetail({
			cli: buildCliProjection(),
			service: buildServiceProjection({
				installedVersion: "0.2.20",
				requiredVersion: "0.2.21",
				status: "update_required",
				wakeBlocked: true,
			}),
			status: "timed_out",
		});

		expect(detail).toContain(
			"This computer reports OpenMeld Service v0.2.20, but v0.2.21 is required."
		);
		expect(detail).toContain("not something you did");
		expect(detail).toContain("Running setup again will not fix this");
		expect(detail).toContain("try again later");
	});

	it("describes an outdated CLI package version separately from the service", () => {
		const detail = formatServiceUpdateVerificationFailureDetail({
			cli: buildCliProjection({
				installedPackageVersion: "0.2.20",
				latestPackageVersion: "0.2.21",
				status: "update_required",
			}),
			service: buildServiceProjection(),
			status: "timed_out",
		});

		expect(detail).toContain(
			"This computer reports OpenMeld CLI v0.2.20, but v0.2.21 is required."
		);
		expect(detail).not.toContain("OpenMeld Service v");
	});

	it("falls back to an unreported/unknown version phrase when versions are missing", () => {
		const detail = formatServiceUpdateVerificationFailureDetail({
			cli: buildCliProjection(),
			service: buildServiceProjection({
				installedVersion: null,
				latestVersion: null,
				requiredVersion: null,
				status: "update_required",
				wakeBlocked: true,
			}),
			status: "timed_out",
		});

		expect(detail).toContain(
			"This computer reports OpenMeld Service an unreported version, but a newer version is required."
		);
	});

	it("uses a neutral phrase instead of interpolating a missing version when no projection ever arrived", () => {
		const detail = formatServiceUpdateVerificationFailureDetail({
			cli: null,
			service: null,
			status: "timed_out",
		});

		expect(detail).toContain(
			"Could not confirm this computer reached the required version."
		);
		expect(detail).not.toContain("vnull");
		expect(detail).not.toContain("vundefined");
		expect(detail).toContain("not something you did");
		expect(detail).toContain("Running setup again will not fix this");
		expect(detail).toContain("try again later");
	});
});

describe("formatServiceUpdateVerificationSuccessDetail", () => {
	it("shows the newly reported OpenMeld Service version", () => {
		const detail = formatServiceUpdateVerificationSuccessDetail({
			cli: buildCliProjection(),
			service: buildServiceProjection({ installedVersion: "0.2.21" }),
			status: "confirmed",
		});

		expect(detail).toBe("Update complete. This computer now reports v0.2.21.");
	});

	it("has nothing to show when the service has not reported an installed version", () => {
		const detail = formatServiceUpdateVerificationSuccessDetail({
			cli: buildCliProjection(),
			service: buildServiceProjection({ installedVersion: null }),
			status: "confirmed",
		});

		expect(detail).toBeNull();
	});
});

it("keeps the failure title stable for the timed_out headline", () => {
	expect(SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE).toBe(
		"Update did not reach the required version"
	);
});

function buildServiceProjection(
	overrides: Partial<LocalServiceComponentUpdateProjection> = {}
): LocalServiceComponentUpdateProjection {
	return {
		installedVersion: "0.2.21",
		latestVersion: "0.2.21",
		reasonCodes: [],
		requiredVersion: null,
		status: "current",
		updatePolicy: "ok",
		wakeBlocked: false,
		...overrides,
	};
}

function buildCliProjection(
	overrides: Partial<LocalCliComponentUpdateProjection> = {}
): LocalCliComponentUpdateProjection {
	return {
		commandContractVersion:
			"openmeld-cli-command-contract-2026-05-local-components-v1",
		installedPackageVersion: "0.2.21",
		latestPackageVersion: "0.2.21",
		reasonCodes: [],
		requiredCommandContractVersion: null,
		status: "current",
		updatePolicy: "ok",
		wakeBlocked: false,
		...overrides,
	};
}

import { describe, expect, it } from "vitest";
import {
	advanceOnboardingProgress,
	buildOnboardingStorageKey,
	completeOnboardingProgress,
	createInitialOnboardingProgress,
	readOnboardingProgress,
	resolveNextOnboardingStep,
	resolveOnboardingReturnPath,
	resolveOnboardingStep,
	resolveOnboardingSteps,
	resolvePreviousOnboardingStep,
	restartOnboardingProgress,
	writeOnboardingProgress,
} from "./onboarding-progress";

function createMemoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

describe("onboarding progress", () => {
	it("persists one versioned account-scoped progress record", () => {
		const storage = createMemoryStorage();
		const progress = advanceOnboardingProgress({
			current: createInitialOnboardingProgress({
				nowMs: 1,
				returnTo: "/o/personal/projects?view=all",
			}),
			nowMs: 2,
			selectedOrganizationId: "org-acme",
			step: "channels",
		});

		writeOnboardingProgress({
			progress,
			storage,
			storageScope: "account-1",
		});

		expect(
			storage.getItem(buildOnboardingStorageKey("account-1"))
		).not.toBeNull();
		expect(
			readOnboardingProgress({ storage, storageScope: "account-1" })
		).toEqual(progress);
		expect(
			readOnboardingProgress({ storage, storageScope: "account-2" })
		).toBeNull();
	});

	it("treats corrupt or older progress as incomplete", () => {
		const storage = createMemoryStorage();
		storage.setItem(
			buildOnboardingStorageKey("account-1"),
			JSON.stringify({ version: 0 })
		);

		expect(
			readOnboardingProgress({ storage, storageScope: "account-1" })
		).toBeNull();
	});

	it("shares progress in this tab when browser storage is unavailable", () => {
		const storage = {
			getItem: () => {
				throw new Error("Storage is blocked");
			},
			setItem: () => {
				throw new Error("Storage is blocked");
			},
		};
		const completed = completeOnboardingProgress({
			current: createInitialOnboardingProgress({ nowMs: 1 }),
			nowMs: 2,
		});

		expect(() =>
			writeOnboardingProgress({
				progress: completed,
				storage,
				storageScope: "account-storage-blocked",
			})
		).not.toThrow();
		expect(
			readOnboardingProgress({
				storage,
				storageScope: "account-storage-blocked",
			})
		).toEqual(completed);
	});

	it("returns to the intended feature inside the selected Organization", () => {
		const current = createInitialOnboardingProgress({
			nowMs: 1,
			returnTo: "/o/personal/projects?view=all",
		});
		const progress = completeOnboardingProgress({ current, nowMs: 2 });

		expect(
			resolveOnboardingReturnPath({
				currentOrganizationSlug: "acme",
				progress,
			})
		).toBe("/o/acme/projects?view=all");
	});

	it("restarts progress without changing the selected real organization", () => {
		const completed = completeOnboardingProgress({
			current: advanceOnboardingProgress({
				current: createInitialOnboardingProgress({
					nowMs: 10,
					returnTo: "/o/acme/spaces/space-1",
				}),
				nowMs: 20,
				selectedOrganizationId: "org-acme",
				step: "complete",
			}),
			nowMs: 30,
		});

		expect(
			restartOnboardingProgress({
				current: completed,
				nowMs: 40,
			})
		).toEqual({
			...completed,
			completedAtMs: null,
			currentStep: "organization",
			updatedAtMs: 40,
		});
	});

	it("uses a shorter setup path for a Personal Workspace", () => {
		expect(resolveOnboardingSteps({ isPersonal: true })).toEqual([
			"organization",
			"plugins",
			"local-agents",
			"complete",
		]);
		expect(
			resolveNextOnboardingStep({
				currentStep: "local-agents",
				isPersonal: true,
			})
		).toBe("complete");
		expect(
			resolvePreviousOnboardingStep({
				currentStep: "complete",
				isPersonal: true,
			})
		).toBe("local-agents");
		expect(
			resolveOnboardingStep({
				currentStep: "setup",
				isPersonal: true,
			})
		).toBe("organization");
	});

	it("keeps the complete Organization setup path", () => {
		expect(resolveOnboardingSteps({ isPersonal: false })).toEqual([
			"organization",
			"channels",
			"plugins",
			"local-agents",
			"setup",
			"invite",
			"complete",
		]);
	});

	it("never returns to onboarding itself", () => {
		const progress = createInitialOnboardingProgress({
			nowMs: 1,
			returnTo: "/o/acme/onboarding",
		});

		expect(
			resolveOnboardingReturnPath({
				currentOrganizationSlug: "acme",
				progress,
			})
		).toBe("/o/acme");
	});

	it("opens Home after a setup with no prior destination", () => {
		const progress = completeOnboardingProgress({
			current: createInitialOnboardingProgress({ nowMs: 1 }),
			nowMs: 2,
		});

		expect(
			resolveOnboardingReturnPath({
				currentOrganizationSlug: "acme",
				progress,
			})
		).toBe("/o/acme");
	});
});

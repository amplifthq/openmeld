import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildComposerDraftStorageKey,
	createComposerDraftRecord,
	EMPTY_COMPOSER_DRAFT_CONTENT,
	readComposerDraft,
	writeComposerDraft,
} from "#/lib/composer-draft-storage";
import { useComposerDraft } from "./use-composer-draft";

describe("useComposerDraft", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("moves a pending Center Agent draft to its canonical Space identity", () => {
		const pendingScope = {
			kind: "center_agent_pending" as const,
			organizationId: "organization-acme",
			ownerAccountId: "account-1",
		};
		const spaceScope = {
			kind: "space" as const,
			ownerAccountId: "account-1",
			profileId: "human-1",
			spaceId: "space-center-agent",
		};
		writeComposerDraft(
			pendingScope,
			createComposerDraftRecord(
				{
					...EMPTY_COMPOSER_DRAFT_CONTENT,
					text: "Continue this draft in the real DM",
				},
				100
			)
		);

		const composer = renderHook(() =>
			useComposerDraft({
				migrateFromScopes: [pendingScope],
				scope: spaceScope,
			})
		);

		expect(composer.result.current.content.text).toBe(
			"Continue this draft in the real DM"
		);
		expect(readComposerDraft(spaceScope)?.text).toBe(
			"Continue this draft in the real DM"
		);
		expect(readComposerDraft(pendingScope)).toBeNull();
	});

	it("overwrites different canonical content when migration timestamps match", () => {
		const pendingScope = {
			kind: "center_agent_pending" as const,
			organizationId: "organization-acme",
			ownerAccountId: "account-1",
		};
		const spaceScope = {
			kind: "space" as const,
			ownerAccountId: "account-1",
			profileId: "human-1",
			spaceId: "space-center-agent",
		};
		const pendingDraft = createComposerDraftRecord(
			{
				...EMPTY_COMPOSER_DRAFT_CONTENT,
				text: "Newest pending content",
			},
			100
		);
		writeComposerDraft(pendingScope, pendingDraft);
		writeComposerDraft(
			spaceScope,
			createComposerDraftRecord(
				{
					...EMPTY_COMPOSER_DRAFT_CONTENT,
					text: "Stale canonical content",
				},
				100
			)
		);

		renderHook(() =>
			useComposerDraft({
				initialDraft: pendingDraft,
				migrateFromScopes: [pendingScope],
				scope: spaceScope,
			})
		);

		expect(readComposerDraft(spaceScope)?.text).toBe("Newest pending content");
		expect(readComposerDraft(pendingScope)).toBeNull();
	});

	it("keeps text entered before the authorized storage scope becomes available", () => {
		const spaceScope = {
			kind: "space" as const,
			ownerAccountId: "account-1",
			profileId: "human-1",
			spaceId: "space-1",
		};
		const composer = renderHook(
			({ hasScope }: { hasScope: boolean }) =>
				useComposerDraft({ scope: hasScope ? spaceScope : null }),
			{ initialProps: { hasScope: false } }
		);

		act(() => {
			composer.result.current.setContent({
				...EMPTY_COMPOSER_DRAFT_CONTENT,
				text: "Do not lose this while identity resolves",
			});
		});
		composer.rerender({ hasScope: true });

		expect(composer.result.current.content.text).toBe(
			"Do not lose this while identity resolves"
		);
		expect(readComposerDraft(spaceScope)?.text).toBe(
			"Do not lose this while identity resolves"
		);
	});

	it("binds asynchronous updates to the conversation scope that created them", () => {
		const taskAScope = {
			kind: "center_agent_task" as const,
			organizationId: "organization-acme",
			ownerAccountId: "account-1",
			taskId: "task-a",
		};
		const taskBScope = {
			...taskAScope,
			taskId: "task-b",
		};
		const composer = renderHook(
			({ scope }: { scope: typeof taskAScope | typeof taskBScope }) =>
				useComposerDraft({ scope }),
			{ initialProps: { scope: taskAScope } }
		);

		act(() => {
			composer.result.current.setContent({
				...EMPTY_COMPOSER_DRAFT_CONTENT,
				text: "Task A draft",
			});
		});
		const completeTaskA = composer.result.current.setContent;
		composer.rerender({ scope: taskBScope });
		act(() => {
			composer.result.current.setContent({
				...EMPTY_COMPOSER_DRAFT_CONTENT,
				text: "Task B draft",
			});
		});

		act(() => {
			completeTaskA(EMPTY_COMPOSER_DRAFT_CONTENT);
		});

		expect(readComposerDraft(taskAScope)).toBeNull();
		expect(readComposerDraft(taskBScope)?.text).toBe("Task B draft");
	});

	it("fails closed when a stored structured mention no longer matches its text", () => {
		const consoleWarn = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const scope = {
			kind: "space" as const,
			ownerAccountId: "account-1",
			profileId: "human-1",
			spaceId: "space-1",
		};
		const storageKey = buildComposerDraftStorageKey(scope);
		window.localStorage.setItem(
			storageKey,
			JSON.stringify({
				authoredMentions: [
					{
						end: 7,
						profileId: "agent-1",
						relation: "wake",
						start: 0,
						text: "@Runner",
					},
				],
				replyToSignalId: null,
				text: "Changed text",
				updatedAtMs: 100,
				version: 1,
			})
		);

		expect(readComposerDraft(scope)).toBeNull();
		expect(window.localStorage.getItem(storageKey)).toBeNull();
		expect(consoleWarn).toHaveBeenCalledWith(
			"Ignoring invalid Composer draft storage entry.",
			{ storageKey }
		);
		consoleWarn.mockRestore();
	});

	it("keeps Human Mention drafts outside the legacy v1 storage key", () => {
		const scope = {
			kind: "space" as const,
			ownerAccountId: "account-1",
			profileId: "human-1",
			spaceId: "space-1",
		};
		const record = createComposerDraftRecord(
			{
				authoredMentions: [
					{
						end: 4,
						profileId: "human-2",
						relation: "mention",
						start: 0,
						text: "@Ava",
					},
				],
				replyToSignalId: null,
				text: "@Ava please review",
			},
			100
		);

		expect(writeComposerDraft(scope, record)).toBe(true);
		const currentStorageKey = buildComposerDraftStorageKey(scope);
		const legacyStorageKey = currentStorageKey.replace(":v2:", ":v1:");
		expect(currentStorageKey).toContain(":v2:");
		expect(window.localStorage.getItem(legacyStorageKey)).toBeNull();
		expect(readComposerDraft(scope)).toMatchObject({
			authoredMentions: [{ relation: "mention" }],
			version: 2,
		});
	});

	it("migrates an existing v1 draft into the current storage format", () => {
		const scope = {
			kind: "space" as const,
			ownerAccountId: "account-1",
			profileId: "human-1",
			spaceId: "space-1",
		};
		const currentStorageKey = buildComposerDraftStorageKey(scope);
		const identity = currentStorageKey.slice(currentStorageKey.indexOf("["));
		const legacyStorageKey = `openmeld.composer-draft:v1:${identity}`;
		window.localStorage.setItem(
			legacyStorageKey,
			JSON.stringify({
				authoredMentions: [
					{
						end: 4,
						profileId: "human-2",
						relation: "reference",
						start: 0,
						text: "@Ava",
					},
				],
				replyToSignalId: null,
				text: "@Ava please review",
				updatedAtMs: 100,
				version: 1,
			})
		);

		expect(readComposerDraft(scope)).toMatchObject({
			authoredMentions: [{ relation: "reference" }],
			version: 2,
		});
		expect(
			JSON.parse(window.localStorage.getItem(currentStorageKey) ?? "null")
		).toMatchObject({ version: 2 });
	});
});

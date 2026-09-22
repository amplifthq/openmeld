import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	type RenderHookOptions,
	render as renderBare,
	renderHook as renderBareHook,
	screen,
	waitFor,
} from "@testing-library/react";
import { forceCloseDatabase, IDBFactory } from "fake-indexeddb";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import {
	readComposerFileDrafts,
	removeComposerFileDraft,
} from "#/lib/spaces/composer-file-drafts";
import { SpaceComposerAttachmentRecovery } from "./space-composer-attachments";
import { useSpaceComposerFiles } from "./use-space-composer-attachments";

type SpaceApi = ReturnType<typeof createUnscopedWebSpaceApi>;
const api = vi.hoisted(() => ({
	discardComposerUpload: vi.fn<SpaceApi["discardComposerUpload"]>(),
	publishComposerUpload: vi.fn<SpaceApi["publishComposerUpload"]>(),
	stageComposerUpload: vi.fn<SpaceApi["stageComposerUpload"]>(),
}));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => api,
}));

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
function QueryWrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
function render(element: ReactNode) {
	return renderBare(element, { wrapper: QueryWrapper });
}
function renderHook<Result, Props>(
	callback: (props: Props) => Result,
	options?: RenderHookOptions<Props>
) {
	return renderBareHook(callback, { ...options, wrapper: QueryWrapper });
}

afterEach(async () => {
	cleanup();
	await Promise.resolve();
	queryClient.clear();
	vi.restoreAllMocks();
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: new IDBFactory(),
	});
});

it("keeps the production controller usable after its real IndexedDB handle closes", async () => {
	const factory = new IDBFactory();
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: factory,
	});
	let cachedDatabase: IDBDatabase | undefined;
	const originalOpen = factory.open.bind(factory);
	const open = vi.spyOn(factory, "open").mockImplementation((...args) => {
		const request = originalOpen(...args);
		request.addEventListener("success", () => {
			cachedDatabase = request.result;
		});
		return request;
	});
	api.stageComposerUpload.mockImplementation(async (input) => ({
		expiresAt: "2099-09-10T00:00:00.000Z",
		id: input.uploadId,
		mimeType: input.mimeType,
		name: input.name,
		sizeBytes: 3,
	}));

	const controller = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "integration",
			profileId: "human-integration",
			spaceId: "space-integration",
		})
	);
	await act(async () => {
		await controller.result.current.addFiles([
			new File(["one"], "one.txt", { type: "text/plain" }),
		]);
	});
	expect(cachedDatabase).toBeDefined();
	forceCloseDatabase(cachedDatabase as unknown as typeof IDBDatabase);

	await act(async () => {
		await controller.result.current.addFiles([
			new File(["two"], "two.txt", { type: "text/plain" }),
		]);
	});
	expect(controller.result.current.files.map((file) => file.fileName)).toEqual([
		"one.txt",
		"two.txt",
	]);
	await expect(
		readComposerFileDrafts("integration:human-integration:space-integration")
	).resolves.toHaveLength(2);

	const removedId = controller.result.current.files[0]?.localId;
	if (!removedId) {
		throw new Error("Expected a restored attachment identity.");
	}
	act(() => controller.result.current.removeFile(removedId));
	await waitFor(async () => {
		await expect(
			readComposerFileDrafts("integration:human-integration:space-integration")
		).resolves.toHaveLength(1);
	});
	await removeComposerFileDraft(
		controller.result.current.files[0]?.localId ?? ""
	);
	expect(open.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it("publishes cleanup transitions to the mounted recovery UI", async () => {
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: new IDBFactory(),
	});
	api.stageComposerUpload.mockImplementation(async (input) => ({
		expiresAt: "2099-09-10T00:00:00.000Z",
		id: input.uploadId,
		mimeType: input.mimeType,
		name: input.name,
		sizeBytes: 3,
	}));
	const controllerRef: {
		current: ReturnType<typeof useSpaceComposerFiles> | null;
	} = { current: null };
	function Harness(): ReactNode {
		const controller = useSpaceComposerFiles({
			organizationSlug: "integration",
			profileId: "cleanup-human",
			spaceId: "cleanup-space",
		});
		controllerRef.current = controller;
		return (
			<SpaceComposerAttachmentRecovery
				cleanup={controller.cleanup}
				onRetryCleanup={(id) => controller.retryCleanup(id)}
				onRetryRestoration={controller.retryRestoration}
				restorationError={controller.restorationError}
			/>
		);
	}
	const view = render(<Harness />);
	await waitFor(() =>
		expect(controllerRef.current?.restorationError).toBeNull()
	);
	await act(async () => {
		await controllerRef.current?.addFiles([
			new File(["one"], "one.txt", { type: "text/plain" }),
		]);
	});
	const id = controllerRef.current?.files[0]?.localId;
	if (!id) {
		throw new Error("Expected an attachment.");
	}
	act(() => controllerRef.current?.removeFile(id));
	expect(screen.getByText("Removing attachment…")).toBeTruthy();
	await waitFor(() =>
		expect(screen.queryByText("Removing attachment…")).toBeNull()
	);

	await act(async () => {
		await controllerRef.current?.addFiles([
			new File(["two"], "two.txt", { type: "text/plain" }),
		]);
	});
	const failedId = controllerRef.current?.files[0]?.localId;
	if (!failedId) {
		throw new Error("Expected a second attachment.");
	}
	const originalTransaction = IDBDatabase.prototype.transaction;
	const transactionSpy = vi
		.spyOn(IDBDatabase.prototype, "transaction")
		.mockImplementationOnce(() => {
			throw new DOMException("Delete failed", "UnknownError");
		})
		.mockImplementation(function transactionAfterFailure(
			this: IDBDatabase,
			...args: Parameters<IDBDatabase["transaction"]>
		) {
			return originalTransaction.call(this, ...args);
		});
	act(() => controllerRef.current?.removeFile(failedId));
	await screen.findByRole("button", { name: "Retry cleanup" });
	view.unmount();
	render(<Harness />);
	await screen.findByRole("button", { name: "Retry cleanup" });
	transactionSpy.mockImplementationOnce(() => {
		throw new DOMException("Retry failed", "UnknownError");
	});
	fireEvent.click(screen.getByRole("button", { name: "Retry cleanup" }));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Retry cleanup" })).toBeTruthy()
	);
	fireEvent.click(screen.getByRole("button", { name: "Retry cleanup" }));
	await waitFor(() =>
		expect(screen.queryByRole("button", { name: "Retry cleanup" })).toBeNull()
	);
});

it("clears a failed empty restoration after the mounted UI retries it", async () => {
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: new IDBFactory(),
	});
	const originalTransaction = IDBDatabase.prototype.transaction;
	vi.spyOn(IDBDatabase.prototype, "transaction")
		.mockImplementationOnce(() => {
			throw new DOMException("Read failed", "UnknownError");
		})
		.mockImplementation(function transactionAfterFailure(
			this: IDBDatabase,
			...args: Parameters<IDBDatabase["transaction"]>
		) {
			return originalTransaction.call(this, ...args);
		});

	function Harness(): ReactNode {
		const controller = useSpaceComposerFiles({
			organizationSlug: "integration",
			profileId: "restore-human",
			spaceId: "restore-space",
		});
		return (
			<SpaceComposerAttachmentRecovery
				cleanup={controller.cleanup}
				onRetryCleanup={controller.retryCleanup}
				onRetryRestoration={controller.retryRestoration}
				restorationError={controller.restorationError}
			/>
		);
	}

	render(<Harness />);
	await screen.findByText("Couldn't restore your attachment drafts.");
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(
			screen.queryByText("Couldn't restore your attachment drafts.")
		).toBeNull()
	);
});

it("handles every caller that joins one failed cleanup retry", async () => {
	const storage = await import("#/lib/spaces/composer-file-drafts");
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: new IDBFactory(),
	});
	api.stageComposerUpload.mockImplementation(async (input) => ({
		expiresAt: "2099-09-10T00:00:00.000Z",
		id: input.uploadId,
		mimeType: input.mimeType,
		name: input.name,
		sizeBytes: 3,
	}));
	const controller = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "integration",
			profileId: "joined-cleanup-human",
			spaceId: "joined-cleanup-space",
		})
	);
	await act(async () => {
		await controller.result.current.addFiles([
			new File(["one"], "one.txt", { type: "text/plain" }),
		]);
	});
	const id = controller.result.current.files[0]?.localId;
	if (!id) {
		throw new Error("Expected an attachment.");
	}
	vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(() => {
		throw new DOMException("Delete failed", "UnknownError");
	});
	act(() => controller.result.current.removeFile(id));
	await waitFor(() =>
		expect(controller.result.current.cleanup).toEqual([
			expect.objectContaining({ id, status: "failed" }),
		])
	);
	let rejectRetry: (error: Error) => void = () => undefined;
	const retryGate = new Promise<void>((_resolve, reject) => {
		rejectRetry = reject;
	});
	const retrySpy = vi
		.spyOn(storage, "retryComposerFileDraftCleanup")
		.mockReturnValueOnce(retryGate);
	const first = controller.result.current.retryCleanup(id);
	const second = controller.result.current.retryCleanup(id);
	rejectRetry(new Error("cleanup unavailable"));
	await expect(Promise.allSettled([first, second])).resolves.toEqual([
		expect.objectContaining({ status: "fulfilled" }),
		expect.objectContaining({ status: "fulfilled" }),
	]);
	expect(retrySpy).toHaveBeenCalledTimes(1);
	expect(controller.result.current.cleanup).toEqual([
		expect.objectContaining({ id, status: "failed" }),
	]);
	retrySpy.mockRestore();
	await controller.result.current.retryCleanup(id);
	await waitFor(() => expect(controller.result.current.cleanup).toEqual([]));
});

it("claims the current attachment batch after discovery restores it", async () => {
	const storage = await import("#/lib/spaces/composer-file-drafts");
	const restoredDraft = {
		createdAt: 1,
		expiresAt: Date.now() + 60_000,
		id: "restored-edit-file",
		scope: "integration:edit-human:edit-space:edit:message-1",
		file: new File(["edit"], "edit.txt", { type: "text/plain" }),
		publishMutationId: "publish-restored-edit-file",
	};
	let releaseDiscovery: (drafts: [typeof restoredDraft]) => void = () =>
		undefined;
	vi.spyOn(storage, "readComposerFileDrafts").mockReturnValueOnce(
		new Promise((resolve) => {
			releaseDiscovery = resolve;
		})
	);
	api.stageComposerUpload.mockImplementation(async (input) => ({
		expiresAt: "2099-09-10T00:00:00.000Z",
		id: input.uploadId,
		mimeType: input.mimeType,
		name: input.name,
		sizeBytes: 4,
	}));
	const controller = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "integration",
			profileId: "edit-human",
			spaceId: "edit-space",
			draftScope: "edit:message-1",
			deferUpload: true,
		})
	);
	const renderSnapshot = controller.result.current.files;
	let discovery!: Promise<void>;
	act(() => {
		discovery = controller.result.current.waitForDiscovery();
	});
	releaseDiscovery([restoredDraft]);
	await act(async () => discovery);
	const claimed = controller.result.current.claimSubmissionFiles();
	expect(renderSnapshot).toEqual([]);
	expect(claimed).toEqual([
		expect.objectContaining({
			fileName: "edit.txt",
			localId: "restored-edit-file",
		}),
	]);
	controller.result.current.finishSubmission(claimed);
});

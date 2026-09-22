import type {
	InboxItem,
	InboxNotificationObservationsResponse,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPendingInboxNotificationItemIds } from "./client-notifications";
import { createInboxNotificationObserver } from "./notification-observer";

const read = vi.hoisted(() => vi.fn());
vi.mock("#/lib/organizations/inbox", () => ({
	observeCurrentInboxNotifications: read,
}));
const identity = {
	organizationId: "org",
	userId: "user",
	deliveryEnabled: true,
};
function item(id: string): InboxItem {
	return {
		id,
		organizationId: "org",
		recipientUserId: "user",
		kind: "space_mention",
		attention: "update",
		importance: "normal",
		readAt: null,
		resolutionStatus: "not_applicable",
		title: "Mention",
		preview: "Hello",
		contextLabel: null,
		createdAt: "2026-09-22T00:00:00Z",
		occurredAt: "2026-09-22T00:00:00Z",
		updatedAt: "2026-09-22T00:00:00Z",
		sourceTarget: { kind: "space", spaceId: "space", signalId: id },
	};
}
function page(
	cursor: string,
	items: InboxItem[] = [],
	hasMore = false
): InboxNotificationObservationsResponse {
	return { organizationId: "org", cursor, items, hasMore };
}
describe("Inbox notification observation", () => {
	beforeEach(() => {
		window.localStorage.clear();
		read.mockReset();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
	});

	it("retains every eligible item across pages and keeps a failed page retryable at the same cursor", async () => {
		const observer = createInboxNotificationObserver(identity);
		const first = Array.from({ length: 50 }, (_, index) =>
			item(`item-${index}`)
		);
		read
			.mockResolvedValueOnce(page("baseline"))
			.mockResolvedValueOnce(page("page-one", first, true))
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(page("page-two", [item("item-50")]));
		expect((await observer()).items).toEqual([]);
		expect((await observer()).hasMore).toBe(true);
		await expect(observer()).rejects.toThrow("offline");
		await observer();
		expect(read.mock.calls.map(([input]) => input.cursor)).toEqual([
			undefined,
			"baseline",
			"page-one",
			"page-one",
		]);
		expect(readPendingInboxNotificationItemIds(identity)).toEqual(
			new Set([...first.map((value) => value.id), "item-50"])
		);
	});

	it("keeps native background observation while disabled from creating a historical delivery backlog", async () => {
		const observer = createInboxNotificationObserver({
			...identity,
			deliveryEnabled: false,
		});
		read
			.mockResolvedValueOnce(page("baseline"))
			.mockResolvedValueOnce(page("next", [item("while-disabled")]));
		await observer();
		expect((await observer()).items).toHaveLength(1);
		expect(readPendingInboxNotificationItemIds(identity).size).toBe(0);
	});

	it("does not advance past an item whose pending record could not be saved", async () => {
		const observer = createInboxNotificationObserver(identity);
		read
			.mockResolvedValueOnce(page("baseline"))
			.mockResolvedValue(page("next", [item("pending")]));
		await observer();
		const write = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementationOnce(() => {
				throw new DOMException("Storage full", "QuotaExceededError");
			});
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await expect(observer()).rejects.toThrow("site storage");
		write.mockRestore();
		await observer();
		expect(read.mock.calls.slice(1).map(([input]) => input.cursor)).toEqual([
			"baseline",
			"baseline",
		]);
		expect(readPendingInboxNotificationItemIds(identity)).toEqual(
			new Set(["pending"])
		);
	});

	it("discards an aborted page before retaining items or advancing its cursor", async () => {
		const observer = createInboxNotificationObserver(identity);
		const controller = new AbortController();
		let resolvePage: (response: InboxNotificationObservationsResponse) => void =
			() => undefined;
		read
			.mockResolvedValueOnce(page("baseline"))
			.mockImplementationOnce(
				() =>
					new Promise<InboxNotificationObservationsResponse>((resolve) => {
						resolvePage = resolve;
					})
			)
			.mockResolvedValueOnce(page("next", [item("new")]));
		await observer();
		const pending = observer(controller.signal);
		controller.abort();
		resolvePage(page("next", [item("new")]));
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(readPendingInboxNotificationItemIds(identity).size).toBe(0);
		await observer();
		expect(read.mock.calls[2][0].cursor).toBe("baseline");
	});

	it("validates the whole recipient scope before retaining any item and excludes already-read items", async () => {
		const observer = createInboxNotificationObserver(identity);
		read
			.mockResolvedValueOnce(page("baseline"))
			.mockResolvedValueOnce(
				page("next", [
					item("valid"),
					{ ...item("wrong-user"), recipientUserId: "other" },
				])
			)
			.mockResolvedValueOnce(
				page("next", [
					{ ...item("read"), readAt: "2026-09-22T01:00:00Z" },
					item("valid"),
				])
			);
		await observer();
		await expect(observer()).rejects.toThrow("scope mismatch");
		expect(readPendingInboxNotificationItemIds(identity).size).toBe(0);
		await observer();
		expect(readPendingInboxNotificationItemIds(identity)).toEqual(
			new Set(["valid"])
		);
	});
});

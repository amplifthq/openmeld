import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { SpaceAttachmentStrip } from "./space-attachment-strip";
import {
	SpaceMessageAttachmentItems,
	SpaceMessageAttachments,
} from "./space-message-attachments";

const item = {
	attachments: [
		{
			id: "legacy-image",
			mimeType: "image/png",
			fileName: "screenshot.png",
			sizeBytes: 12,
			localPreviewUrl: "blob:legacy-original",
		},
	],
	files: [
		{
			fileId: "document",
			mimeType: "application/pdf",
			name: "review.pdf",
			sizeBytes: 128,
			revision: 3,
			localPreviewUrl: null,
		},
	],
} satisfies Pick<SpaceTimelineItem, "attachments" | "files">;
const clients: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) {
		client.clear();
	}
});

describe("shared message attachment ownership", () => {
	it("combines old images and canonical files without nesting message or remove actions", () => {
		const client = new QueryClient();
		clients.push(client);
		const onRemoveAttachment = vi.fn();
		const onRemoveFile = vi.fn();
		const onOpenSpaceFile = vi.fn();
		const view = render(
			<QueryClientProvider client={client}>
				<SpaceAttachmentStrip label="Attachments to edit" size="composer">
					<SpaceMessageAttachmentItems
						item={item}
						onOpenSpaceFile={onOpenSpaceFile}
						onRemoveAttachment={onRemoveAttachment}
						onRemoveFile={onRemoveFile}
						spaceId="space-1"
					/>
				</SpaceAttachmentStrip>
			</QueryClientProvider>
		);
		expect(
			screen.getAllByRole("group", { name: "Attachments to edit" })
		).toHaveLength(1);
		expect(
			screen.getByRole("img", { name: "screenshot.png" }).getAttribute("src")
		).toBe("blob:legacy-original");
		expect(view.container.querySelector("button button")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Remove screenshot.png" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Remove review.pdf" }));
		expect(onRemoveAttachment).toHaveBeenCalledWith("legacy-image");
		expect(onRemoveFile).toHaveBeenCalledWith("document");
		expect(onOpenSpaceFile).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Open review.pdf in Files" })
		);
		expect(onOpenSpaceFile).toHaveBeenCalledWith("document", 3);
	});

	it("keeps existing attachment removal disabled while an edit is submitting", () => {
		const client = new QueryClient();
		clients.push(client);
		const onRemoveFile = vi.fn();
		render(
			<QueryClientProvider client={client}>
				<SpaceMessageAttachmentItems
					disabled
					item={item}
					onRemoveFile={onRemoveFile}
					spaceId="space-1"
				/>
			</QueryClientProvider>
		);
		const button = screen.getByRole("button", { name: "Remove review.pdf" });
		expect(button).toHaveProperty("disabled", true);
		fireEvent.click(button);
		expect(onRemoveFile).not.toHaveBeenCalled();
	});

	it("does not leave attachment pixels or an empty strip behind after recall", () => {
		const view = render(
			<SpaceMessageAttachments
				item={{ ...item, recalledAt: 1 }}
				spaceId="space-1"
			/>
		);
		expect(view.container.childElementCount).toBe(0);
	});
});

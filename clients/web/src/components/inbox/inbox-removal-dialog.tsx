import type { InboxItem, MutateInboxFeedBody } from "@openmeld/schemas/types";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { Button } from "@openmeld/ui/components/button";
import { useState } from "react";

export type InboxRemoval = {
	scope: string;
	target: { item: InboxItem } | { selection: MutateInboxFeedBody };
};

export function useInboxRemoval(input: {
	scope: string;
	removalPending: boolean;
	selectionPending: boolean;
	onDismiss: (item: InboxItem) => void;
	onSelection: (body: MutateInboxFeedBody) => void;
}) {
	const [removal, setRemoval] = useState<InboxRemoval | null>(null);
	return {
		requestRemoval: (item: InboxItem) =>
			setRemoval({ scope: input.scope, target: { item } }),
		requestSelection: (body: MutateInboxFeedBody) => {
			if (body.operation === "dismiss") {
				setRemoval({ scope: input.scope, target: { selection: body } });
			} else {
				input.onSelection(body);
			}
		},
		dialog: (
			<InboxRemovalDialog
				{...input}
				onClose={() => setRemoval(null)}
				pending={input.removalPending || input.selectionPending}
				removal={removal}
			/>
		),
	};
}

export function InboxRemovalDialog(input: {
	removal: InboxRemoval | null;
	scope: string;
	pending: boolean;
	onClose: () => void;
	onDismiss: (item: InboxItem) => void;
	onSelection: (body: MutateInboxFeedBody) => void;
}) {
	const removal = input.removal;
	return (
		<AlertDialog
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			open={removal !== null && removal.scope === input.scope}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove from Inbox?</AlertDialogTitle>
					<AlertDialogDescription>
						{removal && "item" in removal.target
							? "This item and its reminder will be removed from your Inbox, including unread and attention counts."
							: "These updates and their reminders will be removed from your Inbox, including unread and attention counts. New updates won’t be affected."}{" "}
						Original messages and documents won’t be deleted. Pending requests
						stay open. You can’t restore removed items to your Inbox.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button
						disabled={input.pending}
						onClick={() => {
							if (removal?.scope !== input.scope) {
								return;
							}
							if ("item" in removal.target) {
								input.onDismiss(removal.target.item);
							} else {
								input.onSelection(removal.target.selection);
							}
							input.onClose();
						}}
					>
						Remove from Inbox
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

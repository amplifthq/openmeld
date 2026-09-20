import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { type ReactNode, type RefObject, useState } from "react";
import {
	UnsavedChangesDialog,
	UnsavedChangesGuard,
} from "#/components/forms/unsaved-changes-guard";

/** Shared composition for the two existing add flows, not a second draft owner. */
export function OrganizationSkillFlowDialog(input: {
	title: string;
	description: string;
	discardTitle: string;
	discardDescription: string;
	dirty: boolean;
	committing: boolean;
	size: "lg" | "xl";
	finalFocus: RefObject<HTMLButtonElement | null>;
	onClose: () => void;
	children: ReactNode;
	footer: ReactNode;
}) {
	const [confirmClose, setConfirmClose] = useState(false);
	const requestClose = () => {
		if (input.committing) {
			return;
		}
		if (input.dirty) {
			setConfirmClose(true);
		} else {
			input.onClose();
		}
	};
	return (
		<Dialog onOpenChange={(open) => !open && requestClose()} open>
			<DialogContent
				className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
				finalFocus={input.finalFocus}
				showCloseButton={!input.committing}
				size={input.size}
			>
				<DialogHeader className="pr-8">
					<DialogTitle>{input.title}</DialogTitle>
					<DialogDescription>{input.description}</DialogDescription>
				</DialogHeader>
				<ScrollArea className="min-h-0 flex-1" contentClassName="px-1 py-1">
					{input.children}
				</ScrollArea>
				{input.footer}
			</DialogContent>
			<UnsavedChangesDialog
				description={input.discardDescription}
				onCancel={() => setConfirmClose(false)}
				onDiscard={input.onClose}
				open={confirmClose}
				saving={input.committing}
				title={input.discardTitle}
			/>
			<UnsavedChangesGuard
				description={input.discardDescription}
				hasUnsavedChanges={input.dirty || input.committing}
				onDiscard={input.onClose}
				saving={input.committing}
				title={input.discardTitle}
			/>
		</Dialog>
	);
}

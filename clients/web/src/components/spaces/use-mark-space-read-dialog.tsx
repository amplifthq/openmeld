import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { useRef, useState } from "react";

type Selection = { unreadCount: number; commit: () => Promise<void> };

export function useMarkSpaceReadDialog(onPrepare?: () => Promise<Selection>) {
	const [open, setOpen] = useState(false);
	const [selection, setSelection] = useState<Selection | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const request = useRef(0);
	const readyLabel = selection ? "Mark all as read" : "Try again";
	const prepare = async () => {
		if (!onPrepare) {
			return;
		}
		const sequence = ++request.current;
		setOpen(true);
		setError(null);
		setSelection(null);
		setPending(true);
		try {
			const next = await onPrepare();
			if (sequence === request.current) {
				setSelection(next);
			}
		} catch (cause) {
			if (sequence === request.current) {
				setError(
					cause instanceof Error
						? cause.message
						: "Couldn’t load unread updates. Try again."
				);
			}
		} finally {
			if (sequence === request.current) {
				setPending(false);
			}
		}
	};
	const clear = async () => {
		if (!selection || pending) {
			return;
		}
		setPending(true);
		setError(null);
		try {
			await selection.commit();
			setOpen(false);
			setSelection(null);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Couldn’t mark updates as read. Try again."
			);
		} finally {
			setPending(false);
		}
	};

	return {
		open: onPrepare ? prepare : undefined,
		dialog: (
			<Dialog
				onOpenChange={(value) => {
					if (pending && selection) {
						return;
					}
					setOpen(value);
					if (!value) {
						request.current += 1;
						setPending(false);
					}
				}}
				open={open}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Mark all updates as read?</DialogTitle>
						<DialogDescription>
							This will mark all unread updates in this Space, including thread
							replies, as read for you.
						</DialogDescription>
					</DialogHeader>
					{error && (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							disabled={pending && !!selection}
							onClick={() => {
								request.current += 1;
								setOpen(false);
								setPending(false);
							}}
							variant="secondary"
						>
							Cancel
						</Button>
						<Button disabled={pending} onClick={selection ? clear : prepare}>
							{pending ? "Please wait…" : readyLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		),
	};
}

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { type ReactNode, useId } from "react";

export function SharedConversationFields(input: {
	enabled: boolean;
	value: string;
	onChange: (value: string) => void;
	fallback: ReactNode;
}) {
	const id = useId();
	if (!input.enabled) {
		return input.fallback;
	}
	return (
		<div className="grid gap-2 text-sm">
			<label htmlFor={id}>Bot conversation ID</label>
			<Input
				autoComplete="off"
				id={id}
				onChange={(event) => input.onChange(event.target.value)}
				pattern="[A-Za-z0-9_-]{1,256}"
				required
				value={input.value}
			/>
		</div>
	);
}

export function SharedConversationConfirmation(input: {
	open: boolean;
	onCancel: () => void;
	onConnect: () => void;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					input.onCancel();
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Connect bot?</DialogTitle>
					<DialogDescription>
						Shares your Grok Bot conversation. Stopping here stops the bot’s
						current work.
					</DialogDescription>
				</DialogHeader>
				<div className="flex justify-end gap-2">
					<Button onClick={input.onCancel} type="button" variant="outline">
						Cancel
					</Button>
					<Button onClick={input.onConnect} type="button">
						Connect bot
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

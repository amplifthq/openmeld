import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";

export function ChatTitleEditor(input: {
	title: string;
	disabled?: boolean;
	onSave: (title: string) => Promise<void> | void;
}) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<>
			<Button
				aria-label="Rename chat"
				disabled={input.disabled}
				onClick={() => {
					setName(input.title === "New chat" ? "" : input.title);
					setError(null);
					setOpen(true);
				}}
				size="icon-sm"
				variant="ghost"
			>
				<PencilSimpleIcon />
			</Button>
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename chat</DialogTitle>
					</DialogHeader>
					<form
						className="space-y-3"
						onSubmit={async (event) => {
							event.preventDefault();
							if (!name.trim() || pending) {
								return;
							}
							setPending(true);
							try {
								await input.onSave(name.trim());
								setOpen(false);
							} catch {
								setError("Couldn’t rename this chat. Try again.");
							} finally {
								setPending(false);
							}
						}}
					>
						<Input
							aria-label="Chat name"
							autoFocus
							maxLength={160}
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
						{error && (
							<p className="text-destructive text-sm" role="alert">
								{error}
							</p>
						)}
						<Button disabled={pending || !name.trim()} type="submit">
							Save
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

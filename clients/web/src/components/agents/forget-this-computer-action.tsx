"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { cn } from "@openmeld/ui/lib/utils";
import { useState } from "react";
import { SpinnerButton } from "#/components/spinner-button";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { useCurrentOrganizationSlug } from "#/lib/organizations/organization-context";

type ForgetThisComputerActionProps = {
	buttonLabel?: string;
	className?: string;
	computerName?: string | null;
	compact?: boolean;
	helperText?: string | null;
	onForget: () => Promise<void>;
	onForgotten?: () => Promise<void> | void;
};

export function ForgetThisComputerAction(input: ForgetThisComputerActionProps) {
	const orgSlug = useCurrentOrganizationSlug();
	const [isOpen, setIsOpen] = useState(false);
	const [isForgetting, setIsForgetting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const computerName = input.computerName?.trim() ?? null;

	const confirmForget = async () => {
		setIsForgetting(true);
		setErrorMessage(null);
		try {
			await input.onForget();
			if (input.onForgotten) {
				await input.onForgotten();
				setIsOpen(false);
				return;
			}
			window.location.assign(
				buildConnectComputerPath({ orgSlug, session: "fresh" })
			);
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "OpenMeld could not forget this computer. Try again."
			);
		} finally {
			setIsForgetting(false);
		}
	};

	return (
		<Dialog
			onOpenChange={(open) => {
				if (isForgetting) {
					return;
				}
				setIsOpen(open);
				if (!open) {
					setErrorMessage(null);
				}
			}}
			open={isOpen}
		>
			<div className={cn("flex flex-wrap items-center gap-3", input.className)}>
				<DialogTrigger
					render={
						<Button
							size={input.compact ? "sm" : "default"}
							type="button"
							variant={input.compact ? "destructive" : "outline"}
						/>
					}
				>
					{input.buttonLabel ?? "Forget this computer"}
				</DialogTrigger>
				{input.helperText === null ? null : (
					<p className="text-muted-foreground text-xs">
						{input.helperText ??
							"Use this if OpenMeld is stuck using the wrong local service state."}
					</p>
				)}
			</div>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{computerName ? `Forget ${computerName}?` : "Forget this computer?"}
					</DialogTitle>
					<DialogDescription>
						This removes the computer record from this OpenMeld account. Spaces,
						Agents, people, and messages stay unchanged, but Agents that use
						this computer may show Needs setup until you set up this computer
						again.
					</DialogDescription>
				</DialogHeader>
				<p className="text-muted-foreground text-sm">
					{computerName
						? `OpenMeld will stop using ${computerName} for local agents on this account.`
						: "OpenMeld will stop using this computer for local agents on this account."}
				</p>
				{errorMessage ? (
					<p className="text-destructive text-sm">{errorMessage}</p>
				) : null}
				<DialogFooter>
					<DialogClose render={<Button type="button" variant="outline" />}>
						Cancel
					</DialogClose>
					<SpinnerButton
						buttonState={isForgetting ? "loading" : "idle"}
						onClick={confirmForget}
						type="button"
						variant="destructive"
					>
						Forget this computer
					</SpinnerButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

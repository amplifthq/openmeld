import { Button } from "@openmeld/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverTitle,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import { WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";

export function SpaceAttachmentRemoveButton(input: {
	fileName: string;
	disabled: boolean;
	onRemove: () => void;
}) {
	return (
		<button
			aria-label={`Remove ${input.fileName}`}
			className="absolute top-1 right-1 z-10 flex size-6 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			disabled={input.disabled}
			onClick={input.onRemove}
			type="button"
		>
			<XIcon aria-hidden="true" className="size-3" />
		</button>
	);
}

/** Full diagnostics stay reachable by click/keyboard without growing the rail. */
export function SpaceAttachmentFailure(input: {
	file: SpaceComposerFile;
	disabled: boolean;
	onRemove: () => void;
	onRetry?: () => void;
}) {
	const error = input.file.errorMessage ?? "File could not be added.";
	return (
		<>
			<span className="sr-only" role="alert">
				{error}
			</span>
			<Popover>
				<PopoverTrigger
					aria-label={`Attachment error: ${input.file.fileName}`}
					className="absolute bottom-1 left-1 z-10 flex size-6 items-center justify-center rounded-md bg-background text-destructive shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<WarningCircleIcon
						aria-hidden="true"
						className="size-4"
						weight="fill"
					/>
				</PopoverTrigger>
				<PopoverContent
					className="max-w-[calc(100vw-2rem)] rounded-lg"
					side="top"
				>
					<PopoverTitle className="break-all text-xs">
						{input.file.fileName}
					</PopoverTitle>
					<PopoverDescription>{error}</PopoverDescription>
					{input.file.errorRequestId && (
						<p className="break-all text-muted-foreground">
							Request ID: {input.file.errorRequestId}
						</p>
					)}
					<div className="flex gap-2">
						{input.file.failurePhase !== "validation" && input.onRetry && (
							<Button
								disabled={input.disabled}
								onClick={input.onRetry}
								size="sm"
								type="button"
								variant="outline"
							>
								Retry
							</Button>
						)}
						<Button
							disabled={input.disabled}
							onClick={input.onRemove}
							size="sm"
							type="button"
							variant="ghost"
						>
							Remove
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		</>
	);
}

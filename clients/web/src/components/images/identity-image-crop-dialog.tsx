import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Label } from "@openmeld/ui/components/label";
import {
	type IdentityImageCrop,
	type IdentityImageCropDraft,
	resolveIdentityImageCropPlacement,
} from "#/lib/images/identity-image-crop";

const CROP_PREVIEW_SIZE = 240;

export function IdentityImageCropDialog(input: {
	crop: IdentityImageCrop;
	description: string;
	draft: (IdentityImageCropDraft & { file: File }) | null;
	errorMessage: string | null;
	isSaving: boolean;
	onCropChange: (crop: IdentityImageCrop) => void;
	onOpenChange: (open: boolean) => void;
	onSave: () => void;
	previewAlt: string;
	previewShape: "circle" | "square";
	saveLabel: string;
	subject: string;
	title: string;
}) {
	const placement = input.draft
		? resolveIdentityImageCropPlacement({
				crop: input.crop,
				sourceHeight: input.draft.height,
				sourceWidth: input.draft.width,
				subject: input.subject,
				viewportSize: CROP_PREVIEW_SIZE,
			})
		: null;
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.draft !== null}>
			<DialogContent className="gap-5 p-6 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="text-base">{input.title}</DialogTitle>
					<DialogDescription>{input.description}</DialogDescription>
				</DialogHeader>
				{input.draft && placement ? (
					<>
						<div
							className={
								input.previewShape === "circle"
									? "relative mx-auto overflow-hidden rounded-full border border-border bg-muted"
									: "relative mx-auto overflow-hidden border border-border bg-muted"
							}
							style={{ height: CROP_PREVIEW_SIZE, width: CROP_PREVIEW_SIZE }}
						>
							<img
								alt={input.previewAlt}
								className="absolute max-w-none select-none"
								draggable={false}
								height={input.draft.height}
								src={input.draft.previewUrl}
								style={placement}
								width={input.draft.width}
							/>
						</div>
						<div className="grid gap-4">
							<CropRange
								label="Zoom"
								max={3}
								min={1}
								onChange={(zoom) => input.onCropChange({ ...input.crop, zoom })}
								step={0.05}
								value={input.crop.zoom}
							/>
							<div className="grid gap-4 sm:grid-cols-2">
								<CropRange
									label="Horizontal position"
									max={1}
									min={-1}
									onChange={(positionX) =>
										input.onCropChange({ ...input.crop, positionX })
									}
									step={0.05}
									value={input.crop.positionX}
								/>
								<CropRange
									label="Vertical position"
									max={1}
									min={-1}
									onChange={(positionY) =>
										input.onCropChange({ ...input.crop, positionY })
									}
									step={0.05}
									value={input.crop.positionY}
								/>
							</div>
						</div>
					</>
				) : null}
				{input.errorMessage ? (
					<p className="text-destructive text-xs" role="alert">
						{input.errorMessage}
					</p>
				) : null}
				<DialogFooter>
					<Button
						disabled={input.isSaving}
						onClick={() => input.onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={!input.draft || input.isSaving}
						onClick={input.onSave}
						type="button"
					>
						{input.isSaving ? "Saving" : input.saveLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function CropRange(input: {
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	step: number;
	value: number;
}) {
	return (
		<div className="grid gap-2">
			<Label>{input.label}</Label>
			<input
				aria-label={input.label}
				className="h-4 w-full cursor-pointer accent-foreground"
				max={input.max}
				min={input.min}
				onChange={(event) => input.onChange(Number(event.currentTarget.value))}
				step={input.step}
				type="range"
				value={input.value}
			/>
		</div>
	);
}

import {
	ORGANIZATION_SKILL_FILE_MAX_BYTES,
	organizationSkillFileSchema,
} from "@openmeld/schemas";
import type { OrganizationSkillFile } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { useId, useState } from "react";

export function OrganizationSkillAddFileDialog(input: {
	existingPaths: string[];
	onAdd: (file: OrganizationSkillFile) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const id = useId();
	const [file, setFile] = useState<File | null>(null);
	const [path, setPath] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const close = () => {
		setFile(null);
		setPath("");
		setError(null);
		input.onOpenChange(false);
	};
	const add = async () => {
		if (!file || reading) {
			return;
		}
		const normalizedPath = path.trim().normalize("NFC");
		if (
			input.existingPaths.some(
				(existing) => existing.normalize("NFC") === normalizedPath
			)
		) {
			setError("A file already uses this path. Choose another path.");
			return;
		}
		if (file.size > ORGANIZATION_SKILL_FILE_MAX_BYTES) {
			setError("Choose a file smaller than 256 KB.");
			return;
		}
		setReading(true);
		setError(null);
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			let content: string;
			let encoding: "base64" | "utf8";
			try {
				content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
				encoding = "utf8";
			} catch {
				content = btoa(
					Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
				);
				encoding = "base64";
			}
			const candidate = organizationSkillFileSchema.safeParse({
				content,
				encoding,
				mediaType:
					file.type ||
					(encoding === "utf8" ? "text/plain" : "application/octet-stream"),
				path: normalizedPath,
				size: bytes.byteLength,
			});
			if (!candidate.success || normalizedPath === "SKILL.md") {
				setError(
					"Choose a safe path and a file within the current Skill size limit."
				);
				return;
			}
			input.onAdd(candidate.data);
			close();
		} catch {
			setError("Couldn't read this file. Choose it again and retry.");
		} finally {
			setReading(false);
		}
	};
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || reading)) {
					close();
				}
			}}
			open={input.open}
		>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>Add a supporting file</DialogTitle>
					<DialogDescription>
						Add a file to the next Skill version. Agents can read it when
						needed.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor={`${id}-file`}>File</Label>
						<Input
							id={`${id}-file`}
							onChange={(event) => {
								const selected = event.target.files?.[0] ?? null;
								setFile(selected);
								setPath(selected?.name ?? "");
								setError(null);
							}}
							type="file"
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-path`}>Path in Skill</Label>
						<Input
							id={`${id}-path`}
							onChange={(event) => {
								setPath(event.target.value);
								setError(null);
							}}
							placeholder="references/guide.md"
							value={path}
						/>
						<p className="text-muted-foreground text-xs">
							Use folders like references/ or assets/ to organize files.
						</p>
					</div>
					{error && (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button disabled={reading} onClick={close} variant="outline">
						Cancel
					</Button>
					<Button disabled={!(file && path.trim()) || reading} onClick={add}>
						{reading ? "Adding…" : "Add file"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

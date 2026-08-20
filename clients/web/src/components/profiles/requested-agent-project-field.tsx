"use client";

import type { Project } from "@openmeld/schemas/types";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";

const CHOOSE_LATER_VALUE = "choose-later";

export function RequestedAgentProjectField(input: {
	disabled: boolean;
	onChange: (projectId: string) => void;
	projects: readonly Project[];
	value: string;
}) {
	const selectedProject = input.projects.find(
		(project) => project.id === input.value
	);
	return (
		<div className="grid gap-2">
			<Label htmlFor="requested-agent-project">Default Project</Label>
			<Select
				disabled={input.disabled}
				onValueChange={(value) =>
					input.onChange(value === CHOOSE_LATER_VALUE ? "" : value)
				}
				value={input.value || CHOOSE_LATER_VALUE}
			>
				<SelectTrigger
					displayValue={selectedProject?.name ?? "Let the owner choose"}
					id="requested-agent-project"
				/>
				<SelectContent>
					<SelectItem index={0} value={CHOOSE_LATER_VALUE}>
						Let the owner choose
					</SelectItem>
					{input.projects.map((project, index) => (
						<SelectItem index={index + 1} key={project.id} value={project.id}>
							{project.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-xs leading-5">
				OpenMeld will use a managed working folder. The owner can change it
				after approval.
			</p>
		</div>
	);
}

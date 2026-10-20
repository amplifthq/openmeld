import { Folder } from "@openmeld/ui/components/folder-component";
import { cn } from "@openmeld/ui/lib/utils";
import {
	AnimatePresence,
	LayoutGroup,
	motion,
	useIsPresent,
} from "framer-motion";
import { type ReactNode, useId, useState } from "react";
import { AgentCardNavMenu } from "./agent-card-nav-menu";
import { AgentGroupAvatar, AgentGroupContext } from "./agent-group-context";
import type { AgentListItem } from "./agent-list-model";
import { AgentProfileControllerAvatar } from "./agent-profile-controller-avatar";

// Exiting cards remain paintable for the return journey, but cannot receive input.
function FolderContents({ children }: { children: ReactNode }) {
	const present = useIsPresent();
	return <div inert={!present}>{children}</div>;
}

export function AgentFolders({
	groups,
	renderCard,
	onToggle,
}: {
	groups: [string, AgentListItem[]][];
	renderCard: (item: AgentListItem, index: number) => ReactNode;
	onToggle: () => void;
}) {
	const id = useId();
	const [open, setOpen] = useState<string | null>(null);
	const selected = groups.find(([label]) => label === open);
	const previews = groups.flatMap(([, items]) =>
		items.slice(0, 3).map((item) => item.profile.openMeldProfileId)
	);
	return (
		<LayoutGroup id={id}>
			<AgentGroupContext value={previews}>
				<div className="space-y-4">
					<fieldset
						aria-label="Agent folders"
						className="flex flex-wrap gap-x-3 gap-y-3"
					>
						{groups.map(([label, items]) => {
							const expanded = selected?.[0] === label;
							const previewCount = Math.min(items.length, 3);
							let avatarSize = 156;
							if (previewCount === 1) {
								avatarSize = 230;
							} else if (previewCount === 2) {
								avatarSize = 190;
							}
							const avatarSpacing = previewCount === 2 ? 96 : 62;
							return (
								<button
									aria-controls={`${id}-contents`}
									aria-expanded={expanded}
									aria-label={`${expanded ? "Collapse" : "Expand"} ${label}, ${items.length} ${items.length === 1 ? "Agent" : "Agents"}`}
									className={cn(
										"flex w-32 flex-col items-center gap-3 rounded-md px-2 pt-5 pb-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
										expanded && "bg-accent/40"
									)}
									key={label}
									onClick={() => {
										onToggle();
										setOpen(expanded ? null : label);
									}}
									type="button"
								>
									<Folder color="blue" decorative open={expanded} size={0.34}>
										<AnimatePresence initial={false}>
											{!expanded &&
												items.slice(0, 3).map((item, index) => (
													<motion.span
														animate={{ opacity: 1 }}
														className="absolute inline-flex"
														exit={{ opacity: 0 }}
														initial={{ opacity: 0 }}
														key={item.profile.openMeldProfileId}
														style={{
															left:
																(index - (previewCount - 1) / 2) *
																	avatarSpacing -
																avatarSize / 2,
															top:
																-184 +
																Math.abs(index - (previewCount - 1) / 2) * 8,
														}}
														transition={{ duration: 0.16 }}
													>
														<AgentGroupAvatar
															profileId={item.profile.openMeldProfileId}
														>
															<AgentProfileControllerAvatar
																agentControllerRef={item.agentControllerRef}
																profileId={item.profile.openMeldProfileId}
																profileName={item.profile.profileName}
																size={avatarSize}
																variant="plain"
															/>
														</AgentGroupAvatar>
													</motion.span>
												))}
										</AnimatePresence>
									</Folder>
									<span className="flex w-full min-w-0 items-center justify-center gap-1.5 text-xs">
										<span className="truncate font-medium">{label}</span>
										<span className="text-muted-foreground text-xs tabular-nums">
											{items.length}
										</span>
									</span>
								</button>
							);
						})}
					</fieldset>
					<div id={`${id}-contents`}>
						<AnimatePresence initial={false} mode="popLayout">
							{selected && (
								<motion.div
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									initial={{ opacity: 0 }}
									key={selected[0]}
									transition={{ duration: 0.16 }}
								>
									<FolderContents>
										<AgentCardNavMenu
											activeValue={null}
											aria-label={`${selected[0]} Agents`}
										>
											{selected[1].map(renderCard)}
										</AgentCardNavMenu>
									</FolderContents>
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				</div>
			</AgentGroupContext>
		</LayoutGroup>
	);
}

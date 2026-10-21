import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	AnimatePresence,
	LayoutGroup,
	motion,
	useIsPresent,
	useReducedMotion,
} from "framer-motion";
import { type ReactNode, useId, useState } from "react";
import { AgentCardNavMenu } from "./agent-card-nav-menu";
import { AgentGroupAvatar, AgentGroupContext } from "./agent-group-context";
import type { AgentListItem } from "./agent-list-model";
import { AgentProfileControllerAvatar } from "./agent-profile-controller-avatar";

function GroupContents({ children }: { children: ReactNode }) {
	const present = useIsPresent();
	return <div inert={!present}>{children}</div>;
}

export function AgentGroupCards({
	groups,
	renderCard,
	onToggle,
}: {
	groups: [string, AgentListItem[]][];
	renderCard: (item: AgentListItem, index: number) => ReactNode;
	onToggle: () => void;
}) {
	const id = useId();
	const reduceMotion = useReducedMotion();
	const [open, setOpen] = useState<string | null>(null);
	const selected = groups.find(([label]) => label === open);
	const previews = groups.flatMap(([, items]) =>
		items.slice(0, 3).map((item) => item.profile.openMeldProfileId)
	);
	return (
		<LayoutGroup id={id}>
			<AgentGroupContext value={previews}>
				<div className="space-y-3">
					<FluidCardGroup>
						<FluidNavMenu
							activeIndicatorClassName="hidden"
							activeValue={selected?.[0] ?? null}
							aria-label="Agent groups"
							className="[&_[data-sidebar=menu]]:grid [&_[data-sidebar=menu]]:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] [&_[data-sidebar=menu]]:gap-3"
							hoverIndicatorClassName="hidden"
						>
							{groups.map(([label, items], index) => {
								const expanded = selected?.[0] === label;
								return (
									<FluidNavMenuItem index={index} key={label} value={label}>
										<FluidCardItem
											className={`border ${expanded ? "border-foreground/30" : "border-border"}`}
											itemId={label}
										>
											<button
												aria-controls={`${id}-contents`}
												aria-expanded={expanded}
												aria-label={`${expanded ? "Collapse" : "Expand"} ${label}, ${items.length} ${items.length === 1 ? "Agent" : "Agents"}`}
												className="flex w-full flex-col items-center gap-3 rounded-md p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
												onClick={() => {
													onToggle();
													setOpen(expanded ? null : label);
												}}
												type="button"
											>
												<span
													aria-hidden="true"
													className="grid size-24 grid-cols-2 grid-rows-2 place-items-center gap-2"
												>
													{items.slice(0, 3).map((item) => {
														const avatar = (
															<AgentProfileControllerAvatar
																agentControllerRef={item.agentControllerRef}
																key={item.profile.openMeldProfileId}
																profileId={item.profile.openMeldProfileId}
																profileName={item.profile.profileName}
																size={40}
																variant="plain"
															/>
														);
														return expanded ? (
															<span
																className="opacity-30"
																key={item.profile.openMeldProfileId}
															>
																{avatar}
															</span>
														) : (
															<AgentGroupAvatar
																key={item.profile.openMeldProfileId}
																profileId={item.profile.openMeldProfileId}
															>
																{avatar}
															</AgentGroupAvatar>
														);
													})}
													{items.length > 3 && (
														<span className="text-muted-foreground text-sm tabular-nums">
															+{items.length - 3}
														</span>
													)}
												</span>
												<span className="flex w-full min-w-0 items-center justify-center gap-1.5 text-xs">
													<span className="truncate font-medium">{label}</span>
													<span className="text-muted-foreground tabular-nums">
														{items.length}
													</span>
												</span>
											</button>
										</FluidCardItem>
									</FluidNavMenuItem>
								);
							})}
						</FluidNavMenu>
					</FluidCardGroup>
					<div id={`${id}-contents`}>
						<AnimatePresence initial={false} mode="popLayout">
							{selected && (
								<motion.div
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									initial={{ opacity: 0 }}
									key={selected[0]}
									transition={{ duration: reduceMotion ? 0 : 0.2 }}
								>
									<GroupContents>
										<AgentCardNavMenu
											activeValue={null}
											aria-label={`${selected[0]} Agents`}
										>
											{selected[1].map(renderCard)}
										</AgentCardNavMenu>
									</GroupContents>
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				</div>
			</AgentGroupContext>
		</LayoutGroup>
	);
}

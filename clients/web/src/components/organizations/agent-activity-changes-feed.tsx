import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";
import {
	type ActivityView,
	formatProviderName,
	formatRelativeTime,
} from "./agent-activity-derive";

export function AgentActivityChangesFeed(input: {
	emptyContent?: ReactNode;
	feedItems: ActivityView["feedItems"];
	foldedHeartbeatCount: number;
	nowMs: number;
}) {
	return (
		<Card className="rounded-md bg-card py-0" size="sm">
			<CardHeader className="border-b py-3">
				<CardTitle>Changes</CardTitle>
				<CardDescription>State transitions only</CardDescription>
			</CardHeader>
			<CardContent className="px-0">
				{input.feedItems.length > 0 ? (
					<SharedLayoutGroup>
						<ol aria-label="Agent Activity state changes" className="divide-y">
							{input.feedItems.map((item) => (
								<li key={item.eventId}>
									<SharedLayoutItem
										className="relative py-3 pr-3 pl-4"
										itemId={item.eventId}
									>
										<span
											aria-hidden="true"
											className={cn(
												"absolute inset-y-3 left-0 w-[3px]",
												resolveStatusToneIndicatorClassName(item.tone, "solid")
											)}
										/>
										<p className="font-medium text-sm leading-5">
											{item.event.memberName} ·{" "}
											{formatProviderName(item.event.provider)} {item.verb}
										</p>
										<p className="mt-0.5 text-muted-foreground text-xs leading-5">
											{formatRelativeTime(item.event.observedAtMs, input.nowMs)}{" "}
											· {item.projectName}
											{item.event.title ? ` · ${item.event.title}` : ""}
										</p>
									</SharedLayoutItem>
								</li>
							))}
						</ol>
					</SharedLayoutGroup>
				) : (
					<div className="px-3 py-4 text-center text-muted-foreground text-sm">
						{input.emptyContent ?? "No state changes yet."}
					</div>
				)}
				{input.foldedHeartbeatCount > 0 ? (
					<p className="border-t border-dashed px-3 py-3 text-muted-foreground text-xs leading-5">
						{String(input.foldedHeartbeatCount)}{" "}
						{input.foldedHeartbeatCount === 1
							? "heartbeat is"
							: "heartbeats are"}{" "}
						folded into the activity bands — only state changes appear here.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

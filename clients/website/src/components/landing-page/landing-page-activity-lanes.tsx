import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { cn } from "@openmeld/ui/lib/utils";

type LandingActivityLanesProps = {
	className?: string;
};

const ACTIVITY_LANES = [
	{
		accent: "#ef7f5c",
		agentId: "builtin:claude-code",
		agentLabel: "Claude Code",
		member: "Maya Chen",
		project: "Web · main",
		segments: [
			{ duration: 1.7, intensity: 0.32, start: 0.4 },
			{ duration: 2.5, intensity: 0.78, start: 3.1 },
			{ duration: 1.2, intensity: 0.46, start: 7.2 },
			{ duration: 2.7, intensity: 0.92, start: 9.1 },
		],
	},
	{
		accent: "#7487ff",
		agentId: "builtin:codex",
		agentLabel: "Codex",
		member: "Jordan Lee",
		project: "Core · routines",
		segments: [
			{ duration: 2.1, intensity: 0.55, start: 0.8 },
			{ duration: 1.4, intensity: 0.34, start: 4.3 },
			{ duration: 3.2, intensity: 0.86, start: 6.2 },
			{ duration: 1.5, intensity: 0.62, start: 10.1 },
		],
	},
	{
		accent: "#61a98b",
		agentId: "builtin:cursor",
		agentLabel: "Cursor",
		member: "Riley Park",
		project: "CLI · ACP",
		segments: [
			{ duration: 1.6, intensity: 0.42, start: 0.5 },
			{ duration: 2.2, intensity: 0.8, start: 3.2 },
			{ duration: 1.4, intensity: 0.5, start: 6.7 },
			{ duration: 2.4, intensity: 0.9, start: 9.3 },
		],
	},
	{
		accent: "#61a98b",
		agentId: "builtin:opencode",
		agentLabel: "OpenCode",
		member: "Alex Morgan",
		project: "Desktop · release",
		segments: [
			{ duration: 1.2, intensity: 0.38, start: 0.1 },
			{ duration: 2.8, intensity: 0.72, start: 2.2 },
			{ duration: 1.8, intensity: 0.48, start: 6.1 },
			{ duration: 3.1, intensity: 0.88, start: 8.5 },
		],
	},
] as const;

export function LandingActivityLanes({ className }: LandingActivityLanesProps) {
	return (
		<div
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute inset-x-0 top-1/2 z-10 mx-auto max-w-5xl -translate-y-1/2 px-2 sm:px-6",
				className
			)}
			data-testid="landing-agent-activity-lanes"
		>
			<div className="grid grid-cols-[6.75rem_1fr] items-end gap-3 px-3 pb-2 font-geist-pixel-line text-[8px] text-background/42 uppercase tracking-[0.08em] sm:grid-cols-[13rem_1fr] sm:gap-6">
				<span>Member · agent</span>
				<span className="flex justify-between">
					<span>12 hours ago</span>
					<span>Now</span>
				</span>
			</div>

			<div
				className="bg-foreground/86"
				data-testid="landing-agent-activity-lane-stack"
			>
				{ACTIVITY_LANES.map((lane) => (
					<div
						className="grid min-h-[3.75rem] grid-cols-[6.75rem_1fr] items-center gap-3 px-3 py-2 sm:grid-cols-[13rem_1fr] sm:gap-6"
						key={lane.member}
					>
						<div className="min-w-0">
							<p className="truncate font-medium text-background text-xs">
								{lane.member}
							</p>
							<div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-background/56">
								<LocalAgentLogo agentId={lane.agentId} size="sm" />
								<span className="truncate">{lane.agentLabel}</span>
								<span className="hidden text-background/28 sm:inline">·</span>
								<span className="hidden truncate sm:inline">
									{lane.project}
								</span>
							</div>
						</div>

						<div
							className="relative h-7 overflow-hidden"
							style={{
								backgroundImage:
									"repeating-linear-gradient(90deg, color-mix(in srgb, currentColor 13%, transparent) 0 1px, transparent 1px 8.333%)",
							}}
						>
							{lane.segments.map((segment) => (
								<span
									className="absolute inset-y-1"
									key={`${lane.member}-${segment.start}`}
									style={{
										backgroundColor: lane.accent,
										left: `${(segment.start / 12) * 100}%`,
										opacity: segment.intensity,
										width: `${(segment.duration / 12) * 100}%`,
									}}
								/>
							))}
							<span className="absolute inset-y-0 right-0 w-px bg-background/36" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

import { resolveStatusToneSoftTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import type { DemoBeat, VisibleBeatMap } from "../demo-types";

const CLI_ASCII_LOGO = `
██╗    ██╗ █████╗ ██╗  ██╗███████╗██╗      ██████╗  ██████╗ ██████╗
██║    ██║██╔══██╗██║ ██╔╝██╔════╝██║     ██╔═══██╗██╔═══██╗██╔══██╗
██║ █╗ ██║███████║█████╔╝ █████╗  ██║     ██║   ██║██║   ██║██████╔╝
██║███╗██║██╔══██║██╔═██╗ ██╔══╝  ██║     ██║   ██║██║   ██║██╔═══╝
╚███╔███╔╝██║  ██║██║  ██╗███████╗███████╗╚██████╔╝╚██████╔╝██║
 ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═╝`;

type CliIntroStageProps = {
	introBeat: DemoBeat;
	visibleBeatMap: VisibleBeatMap;
};

export function CliIntroStage({
	introBeat,
	visibleBeatMap,
}: CliIntroStageProps) {
	if (visibleBeatMap[introBeat.id] !== true) {
		return null;
	}

	return (
		<section className="motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 pt-4 motion-safe:animate-in motion-safe:duration-500 motion-reduce:animate-none">
			<pre className="overflow-x-auto font-mono text-[0.68rem] text-foreground/76 leading-[1.16] sm:text-[0.78rem]">
				{CLI_ASCII_LOGO}
			</pre>
			<div className="pt-3 font-mono text-[0.86rem] leading-[1.55] sm:text-[0.92rem]">
				<p
					className={cn(
						"opacity-[0.84]",
						resolveStatusToneSoftTextClassName("checking")
					)}
				>
					OPENMELD CLI • https://openmeld.ai
				</p>
				<p className="text-muted-foreground">
					Connect with any AI agents &amp; humans in realtime.
				</p>
			</div>
		</section>
	);
}

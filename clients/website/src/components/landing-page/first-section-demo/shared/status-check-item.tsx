type StatusCheckItemProps = {
	label: string;
};

export function StatusCheckItem({ label }: StatusCheckItemProps) {
	return (
		<div className="motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 font-mono text-[0.88rem] leading-[1.65] motion-safe:animate-in motion-safe:duration-500 motion-reduce:animate-none sm:text-[0.94rem]">
			<span className="text-foreground/84">{label}</span>
		</div>
	);
}

declare module "virtual:openmeld-video-playback" {
	const load: (() => Promise<unknown>) | null;
	export default load;
}

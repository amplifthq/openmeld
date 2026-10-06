import { mergeConfig } from "vite";
import config from "../conversation-preview/vite.config";

const captureConfig = mergeConfig(
	{
		plugins: [
			{
				name: "capture-server-boundary",
				enforce: "pre",
				load(id: string) {
					if (id === "\0conversation-preview:use-conversations") {
						return `
      import { useConversationSidebarFixture } from "#/test-support/conversation-sidebar-fixture";
      export const useConversations = () => ({...useConversationSidebarFixture(), selected: "release"});
    `;
					}
					if (id === "\0conversation-preview:react-start") {
						return `
      const unavailable = () => { throw new Error("Transport is unavailable in product captures"); };
      export const createServerFn = () => ({ inputValidator: () => ({handler: () => unavailable}), handler: () => unavailable });
      export const createIsomorphicFn = () => ({client: fn => ({server: () => fn})});
    `;
					}
				},
			},
		],
	},
	config
);
export default mergeConfig(captureConfig, {
	root: import.meta.dirname,
	optimizeDeps: {
		noDiscovery: true,
		include: [
			"@openmeld/agent-runtime > semver/functions/parse.js",
			"@openmeld/agent-runtime > semver/functions/satisfies.js",
			"platejs",
			"platejs/react",
			"@platejs/mention/react",
			"@platejs/combobox/react",
			"@platejs/basic-nodes/react",
			"@platejs/combobox > react-compiler-runtime",
			"streamdown",
			"@streamdown/cjk",
			"rehype-sanitize",
		],
	},
	server: { host: "127.0.0.1", port: 30_185, strictPort: true },
});

import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import testConfig from "../../vitest.config";

const require = createRequire(import.meta.url);
const externalStorePath = path.dirname(
	require.resolve("use-sync-external-store/package.json", {
		paths: [path.dirname(require.resolve("@tanstack/react-router"))],
	})
);

// Render the production sidebar with fictional, in-memory data. This harness
// never signs in, calls a Worker, or changes an account's conversations.
const mocks: Record<string, string> = {
	"react-start":
		'export const createServerFn = () => ({ handler: () => () => { throw new Error("Server functions are unavailable in the presentation preview"); } });',
	"use-conversations":
		'export { useConversationSidebarFixture as useConversations } from "#/test-support/conversation-sidebar-fixture";',
	"organization-context":
		'export const useAppOrganization = () => ({currentUserId:"preview",currentOrganization:{id:"org",slug:"test"}});',
	"new-chat-dialog": "export const NewChatDialog = () => null;",
	"center-agent-chat-avatar":
		'import React from "react"; export const CenterAgentChatAvatar = () => React.createElement("span", {className:"flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs", "aria-label":"Agent"}, "A");',
	"direct-message-preview":
		'export const useSpaceMessagePreview = () => ({ data: { timestamp: Date.now() - 120000, text: "The latest conversation message." }, isPending: false, isError: false }); export const formatDirectMessageTime = () => "2m";',
};
export default defineConfig({
	root: import.meta.dirname,
	optimizeDeps: {
		noDiscovery: true,
		include: [
			"react",
			"react-dom",
			"react-dom/client",
			"react/jsx-runtime",
			"@base-ui/react",
			"@tanstack/react-query",
			"@tanstack/react-router",
			"@dnd-kit/core",
			"@dnd-kit/sortable",
			"use-sync-external-store/shim",
			"use-sync-external-store/shim/with-selector",
			"sonner",
		],
	},
	plugins: [
		{
			name: "conversation-preview-data",
			enforce: "pre",
			resolveId(source) {
				const name = source.split("/").at(-1);
				return name && mocks[name] ? `\0conversation-preview:${name}` : null;
			},
			load(id) {
				return id.startsWith("\0conversation-preview:")
					? mocks[id.slice("\0conversation-preview:".length)]
					: null;
			},
		},
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"use-sync-external-store": externalStorePath,
			...testConfig.resolve?.alias,
			"#": path.resolve(import.meta.dirname, "../../src"),
		},
	},
	server: { host: "127.0.0.1", port: 30_181, strictPort: true },
});

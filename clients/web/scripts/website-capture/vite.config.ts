import { readFileSync } from "node:fs";
import { mergeConfig } from "vite";
import config from "../conversation-preview/vite.config";

// Keep the real API's named exports, but admit only explicitly implemented local
// operations. Unused server actions fail closed rather than reaching an account.
function demoApi(name: string, module: string, operations: string[]) {
	const source = readFileSync(
		`${import.meta.dirname}/../../src/lib/organizations/${name}.ts`,
		"utf8"
	);
	const names = [...source.matchAll(/export (?:async )?function (\w+)/g)].map(
		(match) => match[1]
	);
	return `import * as demo from ${JSON.stringify(`${import.meta.dirname}/${module}`)}; const unavailable=()=>{throw new Error('This action is unavailable in the demo');}; ${names.map((name) => `export const ${name}=${operations.includes(name) ? `demo.${name}` : "unavailable"};`).join("\n")}`;
}

const captureConfig = mergeConfig(
	{
		plugins: [
			{
				name: "capture-server-boundary",
				enforce: "pre",
				resolveId(source: string) {
					if (source.endsWith("/lib/organizations/organization-directory")) {
						return "\0website-demo:directory-api";
					}
					if (source.endsWith("/lib/organizations/organization-skills")) {
						return "\0website-demo:skills-api";
					}
					if (source.endsWith("/lib/organizations/connector-connections")) {
						return "\0website-demo:plugins-api";
					}
					if (source.endsWith("/lib/organizations/inbox")) {
						return "\0website-demo:inbox";
					}
					if (source.endsWith("/use-inbox-expansion")) {
						return "\0website-demo:inbox-expansion";
					}
					if (source.endsWith("/account-organization-preference")) {
						return "\0website-demo:organization-preference";
					}
					if (source.endsWith("/space-directory-preview")) {
						return "\0website-demo:discovery-preview";
					}
					if (source.endsWith("/use-sidebar-disclosure")) {
						return "\0website-demo:disclosure";
					}
					if (source.endsWith("/use-browser-preference")) {
						return "\0website-demo:preference";
					}
					if (source.endsWith("/sidebar-width-cookie")) {
						return "\0website-demo:geometry";
					}
					if (source.endsWith("/lib/routines/api")) {
						return "\0website-demo:routines-api";
					}
					if (source.endsWith("/use-sidebar-preferences")) {
						return "\0website-demo:sidebar";
					}
					if (source.endsWith("/use-space-list-indicators")) {
						return "\0website-demo:indicators";
					}
					const name = source.split("/").at(-1);
					if (
						["office-file-viewer", "pdf-viewer", "csv-file-preview"].includes(
							name ?? ""
						)
					) {
						return `\0website-demo:${name}`;
					}
					if (source === "@tanstack/react-start/server") {
						return "\0website-demo:server";
					}
				},
				load(id: string) {
					const data = JSON.stringify(`${import.meta.dirname}/demo-data.ts`);
					const inbox = JSON.stringify(`${import.meta.dirname}/demo-inbox.tsx`);
					if (id === "\0website-demo:directory-api") {
						return demoApi("organization-directory", "demo-catalogs.ts", [
							"readCurrentOrganizationDirectory",
							"readCurrentOrganizationProfileDirectory",
							"readCurrentOrganizationAgentRuntimeOverview",
						]);
					}
					if (id === "\0website-demo:inbox") {
						return demoApi("inbox", "demo-inbox.tsx", [
							"listCurrentInboxFeed",
							"mutateCurrentInboxFeed",
							"markCurrentInboxItemRead",
							"getCurrentInboxItem",
							"dismissCurrentInboxItem",
						]);
					}
					if (id === "\0website-demo:skills-api") {
						return demoApi("organization-skills", "demo-catalogs.ts", [
							"listCurrentOrganizationSkills",
							"getCurrentOrganizationSkill",
						]);
					}
					if (id === "\0website-demo:plugins-api") {
						return demoApi("connector-connections", "demo-catalogs.ts", [
							"listCurrentOrganizationConnectorConnections",
							"listCurrentOrganizationAppConnections",
							"listCurrentOrganizationConnectorAppCatalog",
							"listCurrentOrganizationConnectorAppRequests",
							"listPluginAccess",
						]);
					}
					if (id === "\0website-demo:inbox-expansion") {
						return `export {useDemoInboxExpansion as useInboxExpansion} from ${inbox};`;
					}
					if (id === "\0website-demo:organization-preference") {
						return "export const selectLastSelectedOrganization = async()=>{};";
					}
					if (id === "\0website-demo:discovery-preview") {
						return "export const SpaceDirectoryPreview=()=>null;";
					}
					if (id === "\0website-demo:disclosure") {
						return `import {useState} from 'react'; export const useSidebarDisclosure = () => {const [choices,setChoices]=useState({}); return {isOpen:id=>choices[id]??true,setOpen:(id,open)=>setChoices(c=>({...c,[id]:open}))}};`;
					}
					if (id === "\0website-demo:preference") {
						return `import {useState} from 'react'; export const useBrowserPreference = () => useState(null);`;
					}
					if (id === "\0website-demo:geometry") {
						return `
export const SIDEBAR_DEFAULT_WIDTH='15rem', SIDEBAR_MIN_WIDTH='8rem', SIDEBAR_MAX_WIDTH='18rem', OUTER_SIDEBAR_DEFAULT_WIDTH='19.25rem', OUTER_SIDEBAR_MIN_WIDTH='10rem', OUTER_SIDEBAR_MAX_WIDTH='24rem';
export const SIDEBAR_DEFAULT_STATE={width:'15rem',tier:'expanded'}, OUTER_SIDEBAR_DEFAULT_STATE={width:'248px',tier:'expanded'};
export const APP_SIDEBAR_DEFAULT_STATES={inner:SIDEBAR_DEFAULT_STATE,outer:OUTER_SIDEBAR_DEFAULT_STATE};
export const resolveClientSidebarInitialState=(scope,state)=>state??OUTER_SIDEBAR_DEFAULT_STATE;
export const resolveClientInnerSidebarInitialState=(key,state)=>state??SIDEBAR_DEFAULT_STATE;
export const writeOuterSidebarStateCookie=()=>{}, writeInnerSidebarStateCookie=()=>{},rememberClientSidebarState=()=>{};
export const getSidebarState=async()=>SIDEBAR_DEFAULT_STATE,getAppSidebarStates=async()=>APP_SIDEBAR_DEFAULT_STATES,getAppSidebarStatesForRoute=getAppSidebarStates,readAppSidebarStatesFromClientCookie=()=>APP_SIDEBAR_DEFAULT_STATES;
`;
					}
					if (id === "\0website-demo:routines-api") {
						return `export {listCurrentRoutines,listCurrentRoutineTargetSpaces,listCurrentRoutineRuns,pauseCurrentRoutine,resumeCurrentRoutine,updateCurrentRoutine,createCurrentRoutine,deleteCurrentRoutine,resolveRoutineErrorMessage} from ${data};`;
					}
					if (id === "\0website-demo:sidebar") {
						return `export {useDemoSidebarPreferences as useSidebarPreferences} from ${data};`;
					}
					if (id === "\0website-demo:indicators") {
						return "export const useSpaceListIndicators = () => ({unreadBySpaceId:new Map(),activeWakeSummaryBySpaceId:new Map(),activityUnavailable:false,isPending:false});";
					}
					if (id === "\0conversation-preview:organization-context") {
						return `const organization={id:'org',slug:'test',name:'Amplift',isPersonal:false}; export const useAppOrganization = () => ({storageScope:'demo',currentUserId:'preview',currentOrganization:organization,organizations:[organization]}); export const useOptionalAppOrganization = useAppOrganization; export const useCurrentOrganizationSlug = () => 'test'; export const useOptionalCurrentOrganizationSlug = useCurrentOrganizationSlug; export const AppOrganizationProvider = ({children}) => children;`;
					}
					if (id.startsWith("\0website-demo:")) {
						return "export const OfficeFileViewer = () => null; export const PdfViewer = () => null; export const CsvFilePreview = () => null; const unavailable = () => {throw new Error('No server in demo')}; export {unavailable as getRequest, unavailable as getRequestHeaders, unavailable as setCookie, unavailable as deleteCookie, unavailable as setResponseHeader};";
					}
					if (id === "\0conversation-preview:use-conversations") {
						return `export {useDemoConversations as useConversations} from ${data};`;
					}
					if (id === "\0conversation-preview:react-start") {
						return `
      const unavailable = () => { throw new Error("Transport is unavailable in product captures"); };
      export const createServerFn = () => {const builder = { inputValidator: () => builder, validator: () => builder, middleware: () => builder, handler: () => unavailable }; return builder;};
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
	base: "/product-demo/",
	build: {
		outDir: "../../../website/public/product-demo",
		emptyOutDir: true,
		sourcemap: false,
	},
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

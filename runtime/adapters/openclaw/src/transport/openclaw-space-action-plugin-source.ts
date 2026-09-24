import type { describeDispatchSpaceTools } from "@openmeld/adapter-core";

/** Standalone native plugin: packaged CLIs cannot import checkout-only modules. */
export function buildOpenClawSpaceActionPluginSource(
  definitions: ReturnType<typeof describeDispatchSpaceTools>,
  deliveryOnly: boolean
): string {
  return `const DEFINITIONS = ${JSON.stringify(definitions)};\nconst DELIVERY_ONLY = ${JSON.stringify(deliveryOnly)};\n${String.raw`
import { spawn } from "node:child_process";
import { basename, isAbsolute } from "node:path";

const environment = Object.freeze({ ...process.env });
const expectedSession = environment.OPENMELD_OPENCLAW_TOOL_SESSION_ID;
const nativeNames = DEFINITIONS.map((tool) => "openmeld_space_" + tool.name);
let connection;
let connecting;
let closed = false;
let reconcileRequired = false;

function narrow(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return;
  const explicit = Array.isArray(policy.allow) && policy.allow.length > 0;
  if (DELIVERY_ONLY) {
    policy.allow = explicit ? policy.allow.filter((name) => nativeNames.includes(name)) : [...nativeNames];
    // An empty allowlist can mean unrestricted in native policy. Keep an
    // impossible literal when the owner explicitly allows none of our tools.
    if (!policy.allow.length) policy.allow = ["openmeld_delivery_no_permitted_tools"];
    if (Array.isArray(policy.alsoAllow)) policy.alsoAllow = policy.alsoAllow.filter((name) => nativeNames.includes(name));
  } else if (!explicit) {
    policy.alsoAllow = [...new Set([...(policy.alsoAllow ?? []), ...nativeNames])];
  }
  // Never remove explicit deny rules or turn an allowlist into a new grant.
}
function configureTools(config) {
  config.tools ??= {};
  const policies = [config.tools, ...Object.values(config.tools.byProvider ?? {}), config.tools.sandbox?.tools];
  for (const agent of config.agents?.list ?? []) {
    if (environment.OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID && agent.id !== environment.OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID) continue;
    agent.tools ??= {};
    policies.push(agent.tools, ...Object.values(agent.tools.byProvider ?? {}), agent.tools.sandbox?.tools);
  }
  policies.forEach(narrow);
}
function failure(text) {
  return { content: [{ type: "text", text }], isError: true, details: { isError: true } };
}
function endConnection(error) {
  const current = connection;
  connection = undefined;
  if (!current) return;
  current.active = false;
  for (const pending of current.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
  current.pending.clear();
  current.child.stdin.end();
  current.child.kill();
}
function close() {
  closed = true;
  endConnection(new Error("The current Wake invocation ended; no further tool calls are permitted."));
}
function send(current, method, params, notification = false) {
  if (closed || !current.active) return Promise.reject(new Error("The current delivery connection is closed."));
  const id = ++current.sequence;
  if (notification) { current.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reconcileRequired = true;
      endConnection(new Error("The tool response was not confirmed. Use read_receipt before resending; do not assume the action failed."));
    }, 60_000);
    timer.unref?.();
    current.pending.set(id, { resolve, reject, timer });
    current.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function connect() {
  if (closed) throw new Error("The current Wake invocation ended.");
  if (connection?.ready) return connection;
  if (connecting) return connecting;
  connecting = (async () => {
    const command = environment.OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH;
    if (!command || !isAbsolute(command) || basename(command) !== environment.OPENMELD_USER_FACING_CLI_COMMAND) throw new Error("The dispatch-owned CLI path is invalid.");
    const child = spawn(command, ["space", "action", "tool-server"], { env: environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const current = { child, pending: new Map(), sequence: 0, active: true, ready: false, buffer: "" };
    connection = current;
    const fail = () => { if (connection === current) { reconcileRequired = true; endConnection(new Error("The delivery connection ended without a confirmed result. Use read_receipt before resending.")); } };
    child.once("error", fail);
    child.once("close", fail);
    child.stdin.on("error", fail);
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      current.buffer += text;
      if (Buffer.byteLength(current.buffer) > 1024 * 1024) { fail(); return; }
      while (current.active) {
        const end = current.buffer.indexOf("\n");
        if (end < 0) break;
        const line = current.buffer.slice(0, end); current.buffer = current.buffer.slice(end + 1);
        if (!line.trim()) continue;
        let message; try { message = JSON.parse(line); } catch { fail(); return; }
        if (message.method) {
          if (message.id !== undefined) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported server request" } }) + "\n");
          continue;
        }
        const pending = current.pending.get(message.id);
        if (!pending) continue;
        current.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message ?? "The native tool request was rejected."));
        else pending.resolve(message.result);
      }
    });
    try {
      const initialized = await send(current, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "openmeld-openclaw", version: "1" } });
      if (!initialized?.capabilities?.tools) throw new Error("The dispatch service did not expose tools.");
      await send(current, "notifications/initialized", {}, true);
      const listed = await send(current, "tools/list", {});
      const names = listed?.tools?.map((tool) => tool.name).sort();
      if (listed?.nextCursor || JSON.stringify(names) !== JSON.stringify(DEFINITIONS.map((tool) => tool.name).sort())) throw new Error("The current dispatch tool catalog does not match this invocation.");
      current.ready = true;
      return current;
    } catch (error) { endConnection(error); throw error; }
  })();
  try { return await connecting; } finally { connecting = undefined; }
}

export default {
  id: "openmeld-space-action",
  name: "OpenMeld Space Action",
  register(api) {
    configureTools(api.config);
    if (typeof api.on !== "function" || !expectedSession) throw new Error("The native invocation lifecycle cannot be verified.");
    api.on("before_tool_call", (event, context) => {
      if (DELIVERY_ONLY && (context.sessionId !== expectedSession || !nativeNames.includes(event.toolName))) return { block: true, blockReason: "This invocation can only deliver the current Wake's result." };
    });
    api.on("agent_end", (_event, context) => { if (context.sessionId === expectedSession) close(); });
    api.on("session_end", (_event, context) => { if (context.sessionId === expectedSession) close(); });
    api.registerTool((context) => {
      if (context.sessionId !== expectedSession) return [];
      return DEFINITIONS.map((definition) => ({
        name: "openmeld_space_" + definition.name,
        label: definition.title,
        description: definition.description,
        parameters: definition.inputSchema,
        async execute(_callId, args, signal) {
          if (closed || signal?.aborted) return failure("This Wake was cancelled or ended. This call was not executed.");
          if (reconcileRequired && definition.name !== "read_receipt") return failure("A prior result is unconfirmed. Call read_receipt before submitting another final action.");
          const onAbort = () => close();
          signal?.addEventListener("abort", onAbort, { once: true });
          try {
            const current = await connect();
            if (closed || signal?.aborted) return failure("This Wake ended before the call was sent.");
            const result = await send(current, "tools/call", { name: definition.name, arguments: args ?? {} });
            if (!Array.isArray(result?.content)) throw new Error("The tool returned an invalid receipt.");
            if (definition.name === "read_receipt" && !result.isError) reconcileRequired = false;
            return { ...result, details: result.structuredContent ?? { isError: Boolean(result.isError) } };
          } catch (error) {
            reconcileRequired = true;
            return failure(String(error?.message ?? "The tool result could not be confirmed. Use read_receipt before resending."));
          } finally { signal?.removeEventListener("abort", onAbort); }
        },
      }));
    }, { names: nativeNames });
  },
};
`}`;
}

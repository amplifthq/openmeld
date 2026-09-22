import { defineTool, type JsonValue, type ToolDefinition } from "@flue/runtime";
import type { GenericSchema } from "valibot";
import { getRemoteAgentFlueTools } from "../flue-adapter/tools";
import { NODE_CODE_MODE_RUNTIME } from "./node-code-mode-runtime";

// Existing capability/schema tests inspect the complete authorized catalog,
// and invoke deferred entries through the real Code Mode wrapper.
export async function getTestCapabilityCatalog(
  input: Parameters<typeof getRemoteAgentFlueTools>[0]
) {
  const catalog = await getRemoteAgentFlueTools({
    ...input,
    codeModeRuntime: NODE_CODE_MODE_RUNTIME,
  });
  const codeMode = catalog.tools.find((tool) => tool.name === "codemode");
  const entries = catalog.capabilities.map((definition) =>
    defineTool({
      name: definition.name,
      description: definition.description,
      input: definition.input as GenericSchema<
        Record<string, unknown>,
        unknown
      >,
      run: async ({ data, signal }) => {
        if (!codeMode) {
          throw new Error("Missing Code Mode.");
        }
        const output = await codeMode.run({
          data: {
            code: `async () => codemode.${definition.name}(${JSON.stringify(data)})`,
          },
          signal,
          log: console,
          toolCallId: "catalog-code-mode",
        });
        return {
          output: (output as { output: { result: JsonValue } }).output.result,
        };
      },
    })
  );
  const names = new Set(entries.map((entry) => entry.name));
  return [
    ...entries,
    ...catalog.tools.filter((tool) => !names.has(tool.name)),
  ] as ToolDefinition[];
}

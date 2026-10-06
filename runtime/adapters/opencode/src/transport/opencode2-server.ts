import { OpenCode } from "@opencode/client";

export type OpenCode2Client = ReturnType<typeof OpenCode.make>;

export function createOpenCode2Client(
  baseUrl: string,
  password: string
): OpenCode2Client {
  return OpenCode.make({
    baseUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    },
  });
}

export function openCode2Error(code: string, message: string) {
  return Object.assign(new Error(`${code}: ${message}`), {
    code,
    errorType: "adapter" as const,
  });
}

export async function readOpenCode2Inventory(input: {
  baseUrl: string;
  password: string;
  directory: string;
  timeoutMs: number;
}) {
  const client = createOpenCode2Client(input.baseUrl, input.password);
  const options = { signal: AbortSignal.timeout(input.timeoutMs) };
  const info = await client.server.info(options);
  if (!info.version.startsWith("2.")) {
    throw openCode2Error(
      "protocol.invalid",
      "OpenCode returned an unsupported API version."
    );
  }
  const models = await client.model.list(
    { location: { directory: input.directory } },
    options
  );
  return models.data
    .filter((model) => model.enabled)
    .slice(0, 256)
    .map((model) => ({
      id: `${model.providerID}/${model.id}`,
      displayName: model.name,
    }));
}

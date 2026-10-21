import {
  buildSpaceAttachmentObjectKey,
  detectSpaceAttachmentMimeType,
  SPACE_ATTACHMENT_MAX_SIZE_BYTES,
  SPACE_FILE_MAX_SIZE_BYTES,
  spaceAttachmentDescriptorSchema,
  spaceMessageAttachmentSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentTurnEnvelope,
  SpaceAttachmentDescriptor,
  SpaceMessageAttachment,
} from "@openmeld/schemas/types";
import {
  array,
  boolean,
  integer,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  parse as parseValibot,
  picklist,
  pipe,
  strictObject,
  string,
  trim,
} from "valibot";
import { emitRemoteAgentToolUsage } from "../flue-adapter/tool-usage-observability";
import { createMeteredRemoteFetch } from "./ai-usage";
import {
  appendRemoteAgentOutputAttachment,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
} from "./callback-context";
import { callCoreRpc } from "./core-rpc";
import {
  type RemoteAgentDiagnosticsEnv,
  remoteAgentDiagnosticErrorFields,
} from "./diagnostics-content-policy";
import {
  buildRemoteAgentAiGatewayHeaders,
  buildRemoteAgentGatewayMetadata,
  REMOTE_AGENT_MAX_OUTPUT_TOKENS,
  type RemoteAgentModelEnv,
  resolveRemoteAgentAiGatewayOpenRouterBaseUrl,
  resolveRemoteAgentOpenRouterModelId,
} from "./model";
import { REMOTE_AGENT_OPENROUTER_PROVIDER_ROUTING } from "./openrouter-provider-routing";
import { publishRemoteAgentOutputFile } from "./space-file-output";
import { buildRemoteAgentToolContext } from "./tool-context";
import type { RemoteAgentToolDefinition } from "./tool-definition";

const TOOL_TEXT_MAX_CHARS = 40_000;
const RESEARCH_QUERY_MAX_CHARS = 4000;
const BROWSER_PROMPT_MAX_CHARS = 4000;
const BROWSER_SELECTOR_MAX_CHARS = 1000;
const MAX_BROWSER_SELECTORS = 20;
const PRIVATE_IPV6_LINK_LOCAL_PREFIX = /^fe[89ab]/;

const boundedTextSchema = pipe(
  string(),
  trim(),
  minLength(1),
  maxLength(RESEARCH_QUERY_MAX_CHARS)
);
const httpUrlTextSchema = pipe(string(), trim(), minLength(1), maxLength(8192));
const domainListSchema = optional(
  pipe(
    array(pipe(string(), trim(), minLength(1), maxLength(253))),
    maxLength(10)
  )
);
const webSearchInputSchema = strictObject({
  query: boundedTextSchema,
  maxResults: optional(pipe(number(), integer(), minValue(1), maxValue(10))),
  allowedDomains: domainListSchema,
  excludedDomains: domainListSchema,
});
const webFetchInputSchema = strictObject({
  url: httpUrlTextSchema,
  instructions: optional(boundedTextSchema),
  maxContentTokens: optional(
    pipe(number(), integer(), minValue(1000), maxValue(100_000))
  ),
});
const browserNavigationInputShape = {
  url: httpUrlTextSchema,
  waitForSelector: optional(
    pipe(string(), trim(), minLength(1), maxLength(BROWSER_SELECTOR_MAX_CHARS))
  ),
  waitForTimeout: optional(
    pipe(number(), integer(), minValue(0), maxValue(120_000))
  ),
};
const browserReadPageInputSchema = strictObject(browserNavigationInputShape);
const browserGetLinksInputSchema = strictObject({
  ...browserNavigationInputShape,
  excludeExternalLinks: optional(boolean()),
  visibleLinksOnly: optional(boolean()),
});
const browserExtractInputSchema = strictObject({
  ...browserNavigationInputShape,
  prompt: pipe(
    string(),
    trim(),
    minLength(1),
    maxLength(BROWSER_PROMPT_MAX_CHARS)
  ),
});
const browserScrapeInputSchema = strictObject({
  ...browserNavigationInputShape,
  selectors: pipe(
    array(
      pipe(
        string(),
        trim(),
        minLength(1),
        maxLength(BROWSER_SELECTOR_MAX_CHARS)
      )
    ),
    minLength(1),
    maxLength(MAX_BROWSER_SELECTORS)
  ),
});
const browserScreenshotInputSchema = strictObject({
  ...browserNavigationInputShape,
  fileName: optional(pipe(string(), trim(), minLength(1), maxLength(255))),
  format: optional(picklist(["jpeg", "png"])),
  fullPage: optional(boolean()),
  quality: optional(pipe(number(), integer(), minValue(1), maxValue(100))),
  selector: optional(
    pipe(string(), trim(), minLength(1), maxLength(BROWSER_SELECTOR_MAX_CHARS))
  ),
  viewportHeight: optional(
    pipe(number(), integer(), minValue(240), maxValue(4000))
  ),
  viewportWidth: optional(
    pipe(number(), integer(), minValue(320), maxValue(4000))
  ),
});

export const REMOTE_AGENT_EXTERNAL_TOOL_NAMES = [
  "web_search",
  "web_fetch",
  "browser_read_page",
  "browser_get_links",
  "browser_extract",
  "browser_scrape",
  "browser_screenshot",
] as const;

export type RemoteAgentExternalToolName =
  (typeof REMOTE_AGENT_EXTERNAL_TOOL_NAMES)[number];

type AttachmentBucket = {
  delete(key: string): Promise<void>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
};

export type RemoteAgentExternalToolEnv = RemoteAgentModelEnv & {
  REMOTE_AGENT_TOOL_CALL_LIMIT?: string;
  BROWSER?: BrowserRun;
  LOADER?: WorkerLoader;
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
  OPENMELD_SPACE_ATTACHMENTS?: AttachmentBucket;
};

export function getRemoteAgentExternalToolDefinitions(input: {
  coreWorker: RemoteAgentCoreWorkerBinding;
  env?: RemoteAgentExternalToolEnv;
  fetch?: typeof globalThis.fetch;
  storage: RemoteAgentStorage;
  submissionId: string;
}): RemoteAgentToolDefinition<RemoteAgentExternalToolName>[] {
  return [
    {
      name: "web_search",
      description:
        "Search the live public web for current information. Returns a synthesized answer with source URLs and titles. Use browser tools when rendered JavaScript or a screenshot is required.",
      input: webSearchInputSchema,
      execute: async (payload) => {
        const request = parseValibot(webSearchInputSchema, payload);
        return await runOpenRouterResearch({
          ...input,
          operation: "web_search",
          prompt: request.query,
          serverTool: {
            type: "openrouter:web_search",
            parameters: {
              engine: "auto",
              max_results: request.maxResults ?? 5,
              max_total_results: request.maxResults ?? 5,
              search_context_size: "medium",
              ...(request.allowedDomains
                ? { allowed_domains: request.allowedDomains }
                : {}),
              ...(request.excludedDomains
                ? { excluded_domains: request.excludedDomains }
                : {}),
            },
          },
          toolName: "web_search",
        });
      },
    },
    {
      name: "web_fetch",
      description:
        "Read and extract the public content of one URL or PDF through OpenRouter's web fetch service. Use this for static research; use browser_read_page when the page needs JavaScript rendering.",
      input: webFetchInputSchema,
      execute: async (payload) => {
        const request = parseValibot(webFetchInputSchema, payload);
        const url = requirePublicHttpUrl(request.url);
        return await runOpenRouterResearch({
          ...input,
          citationUrl: url,
          operation: "web_fetch",
          prompt: request.instructions
            ? `${request.instructions}\n\nURL: ${url}`
            : `Read this URL and return its relevant content with a concise summary and citations: ${url}`,
          serverTool: {
            type: "openrouter:web_fetch",
            parameters: {
              engine: "openrouter",
              max_uses: 1,
              max_content_tokens: request.maxContentTokens ?? 30_000,
            },
          },
          toolName: "web_fetch",
        });
      },
    },
    {
      name: "browser_read_page",
      description:
        "Fetch and read a known public web page in headless Chrome when web search or web fetch fails, or when the page needs JavaScript rendering. Returns bounded Markdown. This is a one-shot Browser Run action, not a persistent interactive browser session.",
      input: browserReadPageInputSchema,
      execute: async (payload) => {
        const request = parseValibot(browserReadPageInputSchema, payload);
        return await runBrowserJsonAction({
          ...input,
          action: "markdown",
          options: buildBrowserNavigationOptions(request),
          toolName: "browser_read_page",
        });
      },
    },
    {
      name: "browser_get_links",
      description:
        "Open a public webpage in headless Chrome and list its rendered links. Can return visible links only or exclude external links.",
      input: browserGetLinksInputSchema,
      execute: async (payload) => {
        const request = parseValibot(browserGetLinksInputSchema, payload);
        return await runBrowserJsonAction({
          ...input,
          action: "links",
          options: {
            ...buildBrowserNavigationOptions(request),
            ...(request.visibleLinksOnly === undefined
              ? {}
              : { visibleLinksOnly: request.visibleLinksOnly }),
            ...(request.excludeExternalLinks === undefined
              ? {}
              : { excludeExternalLinks: request.excludeExternalLinks }),
          },
          toolName: "browser_get_links",
        });
      },
    },
    {
      name: "browser_extract",
      description:
        "Open a public webpage in headless Chrome and extract structured JSON described by a natural-language prompt.",
      input: browserExtractInputSchema,
      execute: async (payload) => {
        const request = parseValibot(browserExtractInputSchema, payload);
        return await runBrowserJsonAction({
          ...input,
          action: "json",
          options: {
            ...buildBrowserNavigationOptions(request),
            prompt: request.prompt,
          },
          toolName: "browser_extract",
        });
      },
    },
    {
      name: "browser_scrape",
      description:
        "Open a public webpage in headless Chrome and scrape rendered elements using one or more CSS selectors.",
      input: browserScrapeInputSchema,
      execute: async (payload) => {
        const request = parseValibot(browserScrapeInputSchema, payload);
        return await runBrowserJsonAction({
          ...input,
          action: "scrape",
          options: {
            ...buildBrowserNavigationOptions(request),
            elements: request.selectors.map((selector) => ({ selector })),
          },
          toolName: "browser_scrape",
        });
      },
    },
    {
      name: "browser_screenshot",
      description:
        "Open a public webpage in headless Chrome and attach a PNG or JPEG screenshot to the final OpenMeld Space reply. The screenshot must fit the existing 5 MiB image attachment limit. Live View is not enabled.",
      input: browserScreenshotInputSchema,
      execute: async (payload) => {
        const request = parseValibot(browserScreenshotInputSchema, payload);
        return await captureBrowserScreenshot({
          ...input,
          request,
        });
      },
    },
  ];
}

// One research helper call may refine its search a few times.
const RESEARCH_MAX_SERVER_TOOL_STEPS = 3;

type ResearchServerTool = {
  parameters: Record<string, unknown>;
  type: "openrouter:web_fetch" | "openrouter:web_search";
};

async function runOpenRouterResearch(input: {
  citationUrl?: string;
  env?: RemoteAgentExternalToolEnv;
  fetch?: typeof globalThis.fetch;
  operation: "web_fetch" | "web_search";
  prompt: string;
  serverTool: ResearchServerTool;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolName: "web_fetch" | "web_search";
}): Promise<unknown> {
  const env = requireExternalToolEnv(input.env);
  const turn = await buildRemoteAgentToolContext({
    storage: input.storage,
    submissionId: input.submissionId,
    toolName: input.toolName,
  });
  const startedAt = Date.now();
  let outcome: "failed" | "succeeded" = "failed";
  let inputBytes = 0;
  let outputBytes = 0;
  let requestCount = 0;
  try {
    const modelId = resolveRemoteAgentOpenRouterModelId(env, turn.modelRoute);
    const headers = Object.fromEntries(
      Object.entries(
        buildRemoteAgentAiGatewayHeaders({
          env,
          organizationId: turn.context.activeOrganizationId,
          metadata: buildRemoteAgentGatewayMetadata({
            modelId,
            organizationId: turn.context.activeOrganizationId,
          }),
        })
      ).filter((entry): entry is [string, string] => entry[1] !== null)
    );
    const requestBody = JSON.stringify({
      model: modelId,
      messages: [
        {
          role: "user",
          content:
            input.operation === "web_search"
              ? `Search the live web for this query and answer using the sources you find:\n\n${input.prompt}`
              : input.prompt,
        },
      ],
      // Explicit output and server-tool step caps bound the platform credit hold.
      max_tokens: REMOTE_AGENT_MAX_OUTPUT_TOKENS,
      max_tool_calls: RESEARCH_MAX_SERVER_TOOL_STEPS,
      provider: REMOTE_AGENT_OPENROUTER_PROVIDER_ROUTING,
      tools: [input.serverTool],
    });
    inputBytes = requestBody.length;
    const attribution = await readRemoteAgentCallbackContext(
      input.storage,
      input.submissionId
    );
    if (!attribution) {
      throw new Error("Web research requires durable AI usage attribution.");
    }
    const response = await createMeteredRemoteFetch({
      env,
      coreWorker: env.OPENMELD_CORE_WORKER,
      fetch: input.fetch,
      model: modelId,
      storage: input.storage,
      scope: {
        organizationId: attribution.organizationId,
        purpose: "web_research",
        agentProfileId: attribution.agentProfileId,
        spaceId: attribution.spaceId,
        taskId: attribution.taskId ?? null,
        dispatchId: attribution.dispatchId,
        attemptId: attribution.submissionId,
      },
    })(
      `${resolveRemoteAgentAiGatewayOpenRouterBaseUrl(env)}/chat/completions`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(120_000),
      }
    );
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw Object.assign(
        new Error(
          `OpenRouter ${input.operation} failed with HTTP ${response.status}: ${summarizeUnknown(body)}`
        ),
        { status: response.status }
      );
    }
    const parsedResult = parseResearchResponse(body);
    const operationRequestCount =
      input.operation === "web_search"
        ? parsedResult.usage.serverToolUse.webSearchRequests
        : parsedResult.usage.serverToolUse.webFetchRequests;
    requestCount =
      operationRequestCount > 0
        ? operationRequestCount
        : parsedResult.usage.serverToolUse.toolCallsExecuted;
    if (requestCount < 1) {
      throw new Error(
        `OpenRouter completed without executing ${input.serverTool.type}.`
      );
    }
    const result =
      parsedResult.citations.length > 0 || !input.citationUrl
        ? parsedResult
        : {
            ...parsedResult,
            citations: [
              {
                title: "Fetched URL",
                url: input.citationUrl,
              },
            ],
          };
    outputBytes = JSON.stringify(result).length;
    outcome = "succeeded";
    return result;
  } finally {
    emitRemoteAgentToolUsage(env, {
      durationMs: Date.now() - startedAt,
      inputBytes,
      operation: input.operation,
      organizationId: turn.context.activeOrganizationId ?? "unknown",
      outcome,
      outputBytes,
      provider: "openrouter",
      recordedAt: new Date().toISOString(),
      requestCount,
      spaceId: turn.turnEnvelope?.space.id ?? "unknown",
      submissionId: input.submissionId,
      toolName: input.toolName,
    });
  }
}

async function runBrowserJsonAction(input: {
  action: "json" | "links" | "markdown" | "scrape";
  env?: RemoteAgentExternalToolEnv;
  options: unknown;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolName:
    | "browser_extract"
    | "browser_get_links"
    | "browser_read_page"
    | "browser_scrape";
}): Promise<unknown> {
  const env = requireExternalToolEnv(input.env);
  const browser = requireBrowserBinding(env);
  const turn = await buildRemoteAgentToolContext({
    storage: input.storage,
    submissionId: input.submissionId,
    toolName: input.toolName,
  });
  const startedAt = Date.now();
  let browserMs = 0;
  let outcome: "failed" | "succeeded" = "failed";
  let outputBytes = 0;
  const inputBytes = estimateSerializedBytes(input.options);
  try {
    const response = await runBrowserQuickAction(
      browser,
      input.action,
      input.options
    );
    browserMs = readBrowserMs(response);
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw Object.assign(
        new Error(
          `Cloudflare Browser Run ${input.action} failed with HTTP ${response.status}: ${summarizeUnknown(body)}`
        ),
        { status: response.status }
      );
    }
    const bounded = boundBrowserResult(body);
    outputBytes = JSON.stringify(bounded).length;
    outcome = "succeeded";
    return bounded;
  } finally {
    emitRemoteAgentToolUsage(env, {
      browserMs,
      durationMs: Date.now() - startedAt,
      inputBytes,
      operation: input.action,
      organizationId: turn.context.activeOrganizationId ?? "unknown",
      outcome,
      outputBytes,
      provider: "cloudflare_browser",
      recordedAt: new Date().toISOString(),
      spaceId: turn.turnEnvelope?.space.id ?? "unknown",
      submissionId: input.submissionId,
      toolName: input.toolName,
    });
  }
}

async function captureBrowserScreenshot(input: {
  coreWorker: RemoteAgentCoreWorkerBinding;
  env?: RemoteAgentExternalToolEnv;
  request: {
    fileName?: string;
    format?: "jpeg" | "png";
    fullPage?: boolean;
    quality?: number;
    selector?: string;
    url: string;
    viewportHeight?: number;
    viewportWidth?: number;
    waitForSelector?: string;
    waitForTimeout?: number;
  };
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<unknown> {
  const env = requireExternalToolEnv(input.env);
  const browser = requireBrowserBinding(env);
  const turn = await buildRemoteAgentToolContext({
    storage: input.storage,
    submissionId: input.submissionId,
    toolName: "browser_screenshot",
  });
  const startedAt = Date.now();
  let browserMs = 0;
  let outcome: "failed" | "succeeded" = "failed";
  let outputBytes = 0;
  let bucket: AttachmentBucket | null = null;
  let objectKey: string | null = null;
  let descriptor: SpaceAttachmentDescriptor | null = null;
  const inputBytes = estimateSerializedBytes(input.request);
  try {
    const format = input.request.format ?? "png";
    const response = await browser.quickAction(
      "screenshot",
      buildBrowserScreenshotOptions(input.request, format)
    );
    browserMs = readBrowserMs(response);
    if (!response.ok) {
      throw new Error(
        `Cloudflare Browser Run screenshot failed with HTTP ${response.status}: ${await response.text()}`
      );
    }
    const bytes = await response.arrayBuffer();
    outputBytes = bytes.byteLength;
    const useCanonicalSpaceFile = shouldUseCanonicalSpaceFile(
      turn.turnEnvelope
    );
    const maxSizeBytes = useCanonicalSpaceFile
      ? SPACE_FILE_MAX_SIZE_BYTES
      : SPACE_ATTACHMENT_MAX_SIZE_BYTES;
    if (bytes.byteLength < 1 || bytes.byteLength > maxSizeBytes) {
      throw new Error(
        `Browser screenshot is ${bytes.byteLength} bytes; OpenMeld files must be between 1 and ${maxSizeBytes} bytes for this conversation.`
      );
    }
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    if (detectSpaceAttachmentMimeType(bytes) !== mimeType) {
      throw new Error(
        `Cloudflare Browser Run returned bytes that are not a valid ${format.toUpperCase()} screenshot.`
      );
    }
    const fileName =
      input.request.fileName ?? buildDefaultScreenshotFileName(format);
    if (useCanonicalSpaceFile) {
      const spaceId = turn.turnEnvelope?.space.id ?? "";
      const result = await publishRemoteAgentOutputFile({
        bytes,
        clientMutationId: crypto.randomUUID(),
        context: turn.context,
        coreWorker: input.coreWorker,
        mimeType,
        name: fileName,
        spaceId,
        storage: input.storage,
        submissionId: input.submissionId,
      });
      outcome = "succeeded";
      return {
        ...result,
        browserMs,
      };
    }
    bucket = env.OPENMELD_SPACE_ATTACHMENTS ?? null;
    if (!bucket) {
      throw new Error(
        "OPENMELD_SPACE_ATTACHMENTS is unavailable for provider screenshots."
      );
    }
    const recordRequest: Parameters<
      NonNullable<RemoteAgentCoreWorkerBinding["recordSpaceAttachment"]>
    >[0] = {
      context: turn.context,
      fileName,
      mimeType,
      sizeBytes: bytes.byteLength,
      spaceId: turn.turnEnvelope?.space.id ?? "",
    };
    descriptor = spaceAttachmentDescriptorSchema.parse(
      await callCoreRpc(
        input.coreWorker,
        "recordSpaceAttachment",
        recordRequest,
        (binding, request) => binding.recordSpaceAttachment?.(request)
      )
    );
    objectKey = buildSpaceAttachmentObjectKey(descriptor);
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType: mimeType },
    });
    const attachment = toSpaceMessageAttachment(descriptor);
    await appendRemoteAgentOutputAttachment({
      attachment,
      storage: input.storage,
      submissionId: input.submissionId,
    });
    outcome = "succeeded";
    return {
      attachment,
      attachedToFinalReply: true,
      browserMs,
    };
  } catch (error) {
    if (bucket) {
      await cleanUpBrowserScreenshotArtifacts({
        env,
        organizationId: turn.context.activeOrganizationId,
        bucket,
        coreWorker: input.coreWorker,
        descriptor,
        objectKey,
      });
    }
    throw error;
  } finally {
    emitRemoteAgentToolUsage(env, {
      browserMs,
      durationMs: Date.now() - startedAt,
      inputBytes,
      operation: "screenshot",
      organizationId: turn.context.activeOrganizationId ?? "unknown",
      outcome,
      outputBytes,
      provider: "cloudflare_browser",
      recordedAt: new Date().toISOString(),
      spaceId: turn.turnEnvelope?.space.id ?? "unknown",
      submissionId: input.submissionId,
      toolName: "browser_screenshot",
    });
  }
}

function shouldUseCanonicalSpaceFile(
  turnEnvelope: RemoteAgentTurnEnvelope | undefined
): boolean {
  const trigger = turnEnvelope?.trigger;
  if (!trigger) {
    return true;
  }
  if (trigger.source === "slack" || trigger.source === "message_channel") {
    return false;
  }
  return !(
    trigger.source === "routine" && trigger.destination?.kind === "slack_thread"
  );
}

function buildBrowserScreenshotOptions(
  request: {
    fullPage?: boolean;
    quality?: number;
    selector?: string;
    url: string;
    viewportHeight?: number;
    viewportWidth?: number;
    waitForSelector?: string;
    waitForTimeout?: number;
  },
  format: "jpeg" | "png"
): BrowserRunScreenshotOptions {
  const viewportRequested =
    request.viewportHeight !== undefined || request.viewportWidth !== undefined;
  return {
    ...buildBrowserNavigationOptions(request),
    ...(request.selector ? { selector: request.selector } : {}),
    screenshotOptions: {
      encoding: "binary",
      fullPage: request.fullPage ?? false,
      type: format,
      ...(format === "jpeg" && request.quality
        ? { quality: request.quality }
        : {}),
    },
    ...(viewportRequested
      ? {
          viewport: {
            height: request.viewportHeight ?? 1080,
            width: request.viewportWidth ?? 1920,
          },
        }
      : {}),
  };
}

function buildDefaultScreenshotFileName(format: "jpeg" | "png"): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return `browser-screenshot-${timestamp}.${format === "jpeg" ? "jpg" : "png"}`;
}

async function cleanUpBrowserScreenshotArtifacts(input: {
  env?: RemoteAgentDiagnosticsEnv;
  organizationId?: string | null;
  bucket: AttachmentBucket;
  coreWorker: RemoteAgentCoreWorkerBinding;
  descriptor: SpaceAttachmentDescriptor | null;
  objectKey: string | null;
}): Promise<void> {
  const failures: Array<
    { operation: string } & ReturnType<typeof remoteAgentDiagnosticErrorFields>
  > = [];
  if (input.objectKey) {
    await input.bucket.delete(input.objectKey).catch((error) => {
      failures.push({
        operation: "r2_delete",
        ...remoteAgentDiagnosticErrorFields(error, input),
      });
    });
  }
  if (input.descriptor) {
    await callCoreRpc(
      input.coreWorker,
      "deleteSpaceAttachmentRecord",
      {
        attachmentId: input.descriptor.id,
      },
      (binding, request) => binding.deleteSpaceAttachmentRecord?.(request)
    ).catch((error) => {
      failures.push({
        operation: "attachment_metadata_delete",
        ...remoteAgentDiagnosticErrorFields(error, input),
      });
    });
  }
  if (failures.length > 0) {
    console.error("[remote-agent.browser-screenshot.cleanup_failed]", {
      attachmentId: input.descriptor?.id ?? null,
      failures,
      objectKey: input.objectKey,
    });
  }
}

function buildBrowserNavigationOptions(input: {
  url: string;
  waitForSelector?: string;
  waitForTimeout?: number;
}): BrowserRunBaseOptions & { url: string } {
  return {
    url: requirePublicHttpUrl(input.url),
    ...(input.waitForSelector
      ? {
          waitForSelector: {
            selector: input.waitForSelector,
            timeout: 60_000,
          },
        }
      : {}),
    ...(input.waitForTimeout === undefined
      ? {}
      : { waitForTimeout: input.waitForTimeout }),
  };
}

function requireExternalToolEnv(
  env: RemoteAgentExternalToolEnv | undefined
): RemoteAgentExternalToolEnv {
  if (!env) {
    throw new Error("Remote Agent external tool environment is unavailable.");
  }
  return env;
}

function requireBrowserBinding(env: RemoteAgentExternalToolEnv): BrowserRun {
  if (!env.BROWSER) {
    throw new Error("Cloudflare Browser Run binding BROWSER is unavailable.");
  }
  return env.BROWSER;
}

function runBrowserQuickAction(
  browser: BrowserRun,
  action: "json" | "links" | "markdown" | "scrape",
  options: unknown
): Promise<Response> {
  switch (action) {
    case "json":
      return browser.quickAction("json", options as BrowserRunJsonOptions);
    case "links":
      return browser.quickAction("links", options as BrowserRunLinksOptions);
    case "markdown":
      return browser.quickAction(
        "markdown",
        options as BrowserRunMarkdownOptions
      );
    case "scrape":
      return browser.quickAction("scrape", options as BrowserRunScrapeOptions);
    default:
      throw new Error(`Unsupported Browser Run Quick Action: ${action}`);
  }
}

function requirePublicHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("A valid public HTTP or HTTPS URL is required.");
  }
  if (!(url.protocol === "http:" || url.protocol === "https:")) {
    throw new TypeError("Only public HTTP and HTTPS URLs are supported.");
  }
  if (url.username || url.password || isPrivateNetworkHostname(url.hostname)) {
    throw new TypeError(
      "Browser and research tools accept only public URLs without embedded credentials."
    );
  }
  return url.toString();
}

function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6 = normalized.includes(":");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::1" ||
    (isIpv6 &&
      (normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        PRIVATE_IPV6_LINK_LOCAL_PREFIX.test(normalized)))
  ) {
    return true;
  }
  const parts = normalized.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function readBrowserMs(response: Response): number {
  const value = Number(response.headers.get("X-Browser-Ms-Used") ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function boundBrowserResult(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= TOOL_TEXT_MAX_CHARS) {
    return value;
  }
  return {
    result: serialized.slice(0, TOOL_TEXT_MAX_CHARS),
    truncated: true,
  };
}

function parseResearchResponse(value: unknown): {
  answer: string;
  citations: { content?: string; title: string; url: string }[];
  responseId: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    serverToolUse: {
      toolCallsExecuted: number;
      toolCallsRequested: number;
      webFetchRequests: number;
      webSearchRequests: number;
    };
    totalTokens: number;
  };
} {
  if (!value || typeof value !== "object") {
    throw new Error("OpenRouter research returned an invalid response.");
  }
  const body = value as {
    choices?: {
      message?: {
        annotations?: {
          type?: unknown;
          url_citation?: {
            content?: unknown;
            title?: unknown;
            url?: unknown;
          };
        }[];
        content?: unknown;
      };
    }[];
    id?: unknown;
    usage?: {
      completion_tokens?: unknown;
      input_tokens?: unknown;
      output_tokens?: unknown;
      prompt_tokens?: unknown;
      server_tool_use?: {
        web_fetch_requests?: unknown;
        web_search_requests?: unknown;
      };
      server_tool_use_details?: {
        tool_calls_executed?: unknown;
        tool_calls_requested?: unknown;
        web_fetch_requests?: unknown;
        web_search_requests?: unknown;
      };
      total_tokens?: unknown;
    };
  };
  const message = body.choices?.[0]?.message;
  const answer =
    typeof message?.content === "string" ? message.content.trim() : "";
  if (!answer) {
    throw new Error("OpenRouter research returned no answer text.");
  }
  const citations = (message?.annotations ?? []).flatMap((annotation) => {
    const citation = annotation.url_citation;
    if (
      annotation.type !== "url_citation" ||
      typeof citation?.url !== "string"
    ) {
      return [];
    }
    return [
      {
        url: citation.url,
        title:
          typeof citation.title === "string" && citation.title.trim()
            ? citation.title.trim()
            : citation.url,
        ...(typeof citation.content === "string" && citation.content.trim()
          ? { content: citation.content.slice(0, 4000) }
          : {}),
      },
    ];
  });
  return {
    answer: answer.slice(0, TOOL_TEXT_MAX_CHARS),
    citations,
    responseId: typeof body.id === "string" ? body.id : null,
    usage: {
      inputTokens: finiteNonNegativeNumber(
        body.usage?.input_tokens ?? body.usage?.prompt_tokens
      ),
      outputTokens: finiteNonNegativeNumber(
        body.usage?.output_tokens ?? body.usage?.completion_tokens
      ),
      serverToolUse: {
        toolCallsExecuted: finiteNonNegativeNumber(
          body.usage?.server_tool_use_details?.tool_calls_executed
        ),
        toolCallsRequested: finiteNonNegativeNumber(
          body.usage?.server_tool_use_details?.tool_calls_requested
        ),
        webFetchRequests: finiteNonNegativeNumber(
          body.usage?.server_tool_use_details?.web_fetch_requests ??
            body.usage?.server_tool_use?.web_fetch_requests
        ),
        webSearchRequests: finiteNonNegativeNumber(
          body.usage?.server_tool_use_details?.web_search_requests ??
            body.usage?.server_tool_use?.web_search_requests
        ),
      },
      totalTokens: finiteNonNegativeNumber(body.usage?.total_tokens),
    },
  };
}

function toSpaceMessageAttachment(
  descriptor: SpaceAttachmentDescriptor
): SpaceMessageAttachment {
  return spaceMessageAttachmentSchema.parse({
    id: descriptor.id,
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
    ...(descriptor.width === undefined ? {} : { width: descriptor.width }),
    ...(descriptor.height === undefined ? {} : { height: descriptor.height }),
    ...(descriptor.fileName === undefined
      ? {}
      : { fileName: descriptor.fileName }),
  });
}

function finiteNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function estimateSerializedBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function summarizeUnknown(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return String(value).slice(0, 2000);
  }
}

import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdForMutation,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  buildRemoteAgentCoreCallbackBody,
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  getRemoteAgentExternalToolDefinitions,
  type RemoteAgentExternalToolEnv,
  type RemoteAgentExternalToolName,
} from "../agent-core/external-tools";
import {
  createSubmitTurnRequest,
  TEST_NOW_MS,
  TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
} from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const SUBMISSION_ID = "submission_external_tools";

describe("Remote Agent external tools", () => {
  it("runs live web search through the existing AI Gateway and preserves citations and raw usage", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorage(request);
    const writeDataPoint = vi.fn();
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toEqual([
        {
          parameters: {
            engine: "auto",
            max_results: 3,
            max_total_results: 3,
            search_context_size: "medium",
          },
          type: "openrouter:web_search",
        },
      ]);
      expect(body.provider).toEqual({ allow_fallbacks: true });
      expect(body.tool_choice).toBeUndefined();
      expect(body.messages[0].content).toContain("Search the live web");
      const response = {
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            logprobs: null,
            message: {
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    end_index: 18,
                    start_index: 0,
                    title: "Official documentation",
                    url: "https://example.com/docs",
                  },
                },
              ],
              content: "The current answer.",
              refusal: null,
              role: "assistant",
            },
          },
        ],
        created: 1_752_000_000,
        id: "generation_123",
        model: "openai/gpt-4.1-mini",
        object: "chat.completion",
        usage: {
          completion_tokens: 42,
          prompt_tokens: 120,
          server_tool_use_details: { web_search_requests: 1 },
          total_tokens: 162,
        },
      } satisfies ChatCompletionsOutput & {
        usage: CompletionUsage & {
          server_tool_use_details: { web_search_requests: number };
        };
      };
      return Promise.resolve(Response.json(response));
    });
    const tools = getRemoteAgentExternalToolDefinitions({
      coreWorker: {},
      env: externalToolEnv({ writeDataPoint }),
      fetch: fetchMock,
      storage,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      executeTool(tools, "web_search", {
        maxResults: 3,
        query: "What changed this week?",
      })
    ).resolves.toEqual({
      answer: "The current answer.",
      citations: [
        {
          title: "Official documentation",
          url: "https://example.com/docs",
        },
      ],
      responseId: "generation_123",
      usage: {
        inputTokens: 120,
        outputTokens: 42,
        serverToolUse: {
          toolCallsExecuted: 0,
          toolCallsRequested: 0,
          webFetchRequests: 0,
          webSearchRequests: 1,
        },
        totalTokens: 162,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/openrouter/chat/completions"),
      expect.objectContaining({ method: "POST" })
    );
    const providerInit = fetchMock.mock.calls[0]?.[1];
    const providerHeaders = new Headers(providerInit?.headers);
    expect(providerHeaders.get("cf-aig-authorization")).toBe(
      "Bearer test-ai-gateway-token"
    );
    expect(providerHeaders.has("cf-aig-byok-alias")).toBe(false);
    // The explicit output cap bounds the platform credit hold.
    expect(JSON.parse(String(providerInit?.body)).max_tokens).toBe(8192);
    expect(JSON.parse(String(providerInit?.body)).max_tool_calls).toBe(3);
    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        indexes: ["org_123"],
        blobs: [
          "remote_agent.tool_usage.v1",
          "web_search",
          "openrouter",
          "web_search",
          "succeeded",
          request.spaceId,
          SUBMISSION_ID,
          expect.any(String),
        ],
      })
    );
  });

  it("runs single-URL research through OpenRouter web fetch and observes the provider request", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const writeDataPoint = vi.fn();
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[0].content).toContain("https://example.com/report");
      expect(body.tools).toEqual([
        {
          parameters: {
            engine: "openrouter",
            max_content_tokens: 12_000,
            max_uses: 1,
          },
          type: "openrouter:web_fetch",
        },
      ]);
      expect(body.provider).toEqual({ allow_fallbacks: true });
      expect(body.tool_choice).toBeUndefined();
      const response = {
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            logprobs: null,
            message: {
              content: "The report grew 20% year over year.",
              refusal: null,
              role: "assistant",
            },
          },
        ],
        created: 1_752_000_000,
        id: "generation_web_fetch_123",
        model: "openai/gpt-4.1-mini",
        object: "chat.completion",
        usage: {
          completion_tokens: 20,
          prompt_tokens: 80,
          server_tool_use_details: {
            tool_calls_executed: 3,
            tool_calls_requested: 3,
          },
          total_tokens: 100,
        },
      } satisfies ChatCompletionsOutput & {
        usage: CompletionUsage & {
          server_tool_use_details: {
            tool_calls_executed: number;
            tool_calls_requested: number;
          };
        };
      };
      return Promise.resolve(Response.json(response));
    });
    const tools = getRemoteAgentExternalToolDefinitions({
      coreWorker: {},
      env: externalToolEnv({ writeDataPoint }),
      fetch: fetchMock,
      storage,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      executeTool(tools, "web_fetch", {
        instructions: "Extract the year-over-year growth.",
        maxContentTokens: 12_000,
        url: "https://example.com/report",
      })
    ).resolves.toMatchObject({
      answer: "The report grew 20% year over year.",
      citations: [
        {
          title: "Fetched URL",
          url: "https://example.com/report",
        },
      ],
      usage: {
        serverToolUse: {
          toolCallsExecuted: 3,
          toolCallsRequested: 3,
          webFetchRequests: 0,
          webSearchRequests: 0,
        },
      },
    });
    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        blobs: expect.arrayContaining([
          "web_fetch",
          "openrouter",
          "web_fetch",
          "succeeded",
        ]),
      })
    );
  });

  it("uses Browser Run Quick Actions for rendered Markdown and records browser milliseconds", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const writeDataPoint = vi.fn();
    const browserResponse = {
      result: "# Rendered page",
      success: true,
      meta: { status: 200, title: "Rendered page" },
    } satisfies BrowserRunMarkdownSuccessResponse;
    const quickAction = vi.fn(async () =>
      Response.json(browserResponse, {
        headers: { "X-Browser-Ms-Used": "321" },
      })
    );
    const tools = getRemoteAgentExternalToolDefinitions({
      coreWorker: {},
      env: externalToolEnv({ quickAction, writeDataPoint }),
      storage,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      executeTool(tools, "browser_read_page", {
        url: "https://example.com/docs",
        waitForTimeout: 250,
      })
    ).resolves.toEqual({
      result: "# Rendered page",
      success: true,
      meta: { status: 200, title: "Rendered page" },
    });
    expect(quickAction).toHaveBeenCalledWith("markdown", {
      url: "https://example.com/docs",
      waitForTimeout: 250,
    });
    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        blobs: expect.arrayContaining([
          "browser_read_page",
          "cloudflare_browser",
          "markdown",
        ]),
        doubles: expect.arrayContaining([321]),
      })
    );
  });

  it("stores a browser screenshot as a canonical Space File and includes it in the final callback", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorage(request);
    const imageBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).buffer;
    const quickAction = vi.fn(
      async () =>
        new Response(imageBytes, {
          headers: {
            "Content-Type": "image/png",
            "X-Browser-Ms-Used": "456",
          },
        })
    );
    const actor = {
      displayName: "Center Agent",
      ownerUserId: "user_1",
      profileId: request.agentProfileId,
      profileKind: "agent" as const,
    };
    const writeSpaceFileContent = vi.fn<
      NonNullable<RemoteAgentCoreWorkerBinding["writeSpaceFileContent"]>
    >(async () => ({
      createdAt: new Date(TEST_NOW_MS).toISOString(),
      createdBy: actor,
      id: "file_browser_screenshot",
      kind: "file" as const,
      latestRevision: {
        createdAt: new Date(TEST_NOW_MS).toISOString(),
        createdBy: actor,
        fileId: "file_browser_screenshot",
        id: "revision_browser_screenshot",
        mimeType: "image/png",
        revision: 1,
        sizeBytes: imageBytes.byteLength,
      },
      name: "home.png",
      origin: "artifact" as const,
      parentId: null,
      path: "/home.png",
      spaceId: request.spaceId,
      updatedAt: new Date(TEST_NOW_MS).toISOString(),
      updatedBy: actor,
      trashedAt: null,
      trashedBy: null,
    }));
    const tools = getRemoteAgentExternalToolDefinitions({
      coreWorker: { writeSpaceFileContent },
      env: externalToolEnv({
        quickAction,
      }),
      storage,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      executeTool(tools, "browser_screenshot", {
        fileName: "home.png",
        url: "https://example.com",
      })
    ).resolves.toMatchObject({
      addedToSpaceFiles: true,
      attachedToFinalReply: true,
      file: {
        fileId: "file_browser_screenshot",
        mimeType: "image/png",
        name: "home.png",
        revision: 1,
        sizeBytes: 8,
      },
      browserMs: 456,
    });
    expect(writeSpaceFileContent).toHaveBeenCalledWith({
      bytes: imageBytes,
      context: expect.objectContaining({
        activeOrganizationId: request.organizationId,
      }),
      spaceId: request.spaceId,
      write: {
        baseRevision: null,
        clientMutationId: expect.any(String),
        fileId: expect.any(String),
        mimeType: "image/png",
        name: "home.png",
        origin: "artifact",
        parentId: null,
        revisionId: expect.any(String),
        sizeBytes: 8,
        spaceId: request.spaceId,
      },
    });
    const canonicalWrite = writeSpaceFileContent.mock.calls[0]?.[0].write;
    if (!canonicalWrite) {
      throw new Error("Expected the screenshot to be written as a Space File.");
    }
    expect(canonicalWrite.fileId).toBe(
      await buildSpaceFileEntryIdForMutation(canonicalWrite.clientMutationId)
    );
    expect(canonicalWrite.revisionId).toBe(
      await buildSpaceFileRevisionIdForMutation({
        baseRevision: null,
        bytes: imageBytes,
        clientMutationId: canonicalWrite.clientMutationId,
        mimeType: "image/png",
        name: "home.png",
        parentId: null,
      })
    );

    const context = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    expect(context?.outputFiles).toEqual([
      {
        fileId: "file_browser_screenshot",
        mimeType: "image/png",
        name: "home.png",
        revision: 1,
        sizeBytes: 8,
      },
    ]);
    expect(
      buildRemoteAgentCoreCallbackBody({
        context: context ?? missingContext(),
        text: "Here is the screenshot.",
      })
    ).toMatchObject({
      files: [
        {
          fileId: "file_browser_screenshot",
          mimeType: "image/png",
          name: "home.png",
          revision: 1,
          sizeBytes: 8,
        },
      ],
      status: "completed",
      text: "Here is the screenshot.",
    });
  });

  it("keeps provider conversation screenshots as provider attachments", async () => {
    const baseRequest = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      turnEnvelope: {
        ...baseRequest.turnEnvelope,
        trigger: {
          channelId: "channel_123",
          source: "slack",
          teamId: "team_123",
          threadTs: "123.456",
        },
      },
    });
    const storage = await createStorage(request);
    const imageBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).buffer;
    const bucket = {
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const recordSpaceAttachment = vi.fn(async () => ({
      createdAt: new Date(TEST_NOW_MS).toISOString(),
      fileName: "slack-thread.png",
      id: "attachment_provider_screenshot",
      mimeType: "image/png" as const,
      organizationId: request.organizationId,
      sizeBytes: imageBytes.byteLength,
      spaceId: request.spaceId,
    }));
    const writeSpaceFileContent = vi.fn();
    const tools = getRemoteAgentExternalToolDefinitions({
      coreWorker: { recordSpaceAttachment, writeSpaceFileContent },
      env: externalToolEnv({
        bucket,
        quickAction: vi.fn(
          async () =>
            new Response(imageBytes, {
              headers: { "Content-Type": "image/png" },
            })
        ),
      }),
      storage,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      executeTool(tools, "browser_screenshot", {
        fileName: "slack-thread.png",
        url: "https://example.com",
      })
    ).resolves.toMatchObject({
      attachment: {
        fileName: "slack-thread.png",
        id: "attachment_provider_screenshot",
        mimeType: "image/png",
        sizeBytes: 8,
      },
      attachedToFinalReply: true,
    });
    expect(writeSpaceFileContent).not.toHaveBeenCalled();
    expect(recordSpaceAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "slack-thread.png",
        spaceId: request.spaceId,
      })
    );
    expect(bucket.put).toHaveBeenCalledWith(
      "org/org_123/space/space_123/attachment_provider_screenshot",
      imageBytes,
      { httpMetadata: { contentType: "image/png" } }
    );

    const context = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    expect(context?.outputFiles).toBeUndefined();
    expect(
      buildRemoteAgentCoreCallbackBody({
        context: context ?? missingContext(),
        text: "Here is the screenshot.",
      })
    ).toMatchObject({
      attachments: [
        {
          fileName: "slack-thread.png",
          id: "attachment_provider_screenshot",
          mimeType: "image/png",
          sizeBytes: 8,
        },
      ],
      status: "completed",
      text: "Here is the screenshot.",
    });
  });

  it("rejects invalid screenshot bytes before creating a Space File", async () => {
    const writeSpaceFileContent = vi.fn();
    const tools = getRemoteAgentExternalToolDefinitions({
      coreWorker: { writeSpaceFileContent },
      env: externalToolEnv({
        bucket: {
          delete: vi.fn(async () => undefined),
          put: vi.fn(async () => undefined),
        },
        quickAction: vi.fn(
          async () =>
            new Response(new TextEncoder().encode("not an image"), {
              headers: { "Content-Type": "image/png" },
            })
        ),
      }),
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: SUBMISSION_ID,
    });

    await expect(
      executeTool(tools, "browser_screenshot", {
        url: "https://example.com",
      })
    ).rejects.toThrow("not a valid PNG screenshot");
    expect(writeSpaceFileContent).not.toHaveBeenCalled();
  });

  it("maps a Proxy-backed missing Core screenshot method to the stable RPC error", async () => {
    const imageBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).buffer;
    const coreWorker = new Proxy(
      {},
      {
        get: (_target, property) =>
          vi.fn(() =>
            Promise.reject(
              new Error(
                `The RPC receiver does not implement the method "${String(property)}".`
              )
            )
          ),
      }
    );
    const tools = getRemoteAgentExternalToolDefinitions({
      coreWorker,
      env: externalToolEnv({
        quickAction: vi.fn(
          async () =>
            new Response(imageBytes, {
              headers: { "Content-Type": "image/png" },
            })
        ),
      }),
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: SUBMISSION_ID,
    });

    await expect(
      executeTool(tools, "browser_screenshot", {
        url: "https://example.com",
      })
    ).rejects.toThrow(
      "OpenMeld Core RPC writeSpaceFileContent is unavailable."
    );
  });

  it("rejects private-network browser targets before calling Browser Run", async () => {
    const quickAction = vi.fn();
    const tools = getRemoteAgentExternalToolDefinitions({
      coreWorker: {},
      env: externalToolEnv({ quickAction }),
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: SUBMISSION_ID,
    });

    await expect(
      executeTool(tools, "browser_read_page", {
        url: "http://127.0.0.1:8787/private",
      })
    ).rejects.toThrow("only public URLs");
    expect(quickAction).not.toHaveBeenCalled();
  });
});

async function createStorage(
  request: ReturnType<typeof createSubmitTurnRequest>
): Promise<InMemoryDurableObjectStorage> {
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        requestId: SUBMISSION_ID,
        status: "pending",
        submissionId: SUBMISSION_ID,
      },
      nowMs: TEST_NOW_MS,
      request,
    })
  );
  return storage;
}

function executeTool(
  tools: ReturnType<typeof getRemoteAgentExternalToolDefinitions>,
  name: RemoteAgentExternalToolName,
  input: Record<string, unknown>
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool.execute(input);
}

function externalToolEnv(input: {
  bucket?: {
    delete(key: string): Promise<void>;
    put(key: string, value: ArrayBuffer): Promise<unknown>;
  };
  quickAction?: (
    action: string,
    options: Record<string, unknown>
  ) => Promise<Response>;
  writeDataPoint?: (point: unknown) => void;
}): RemoteAgentExternalToolEnv {
  return {
    ...TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
    BROWSER: input.quickAction
      ? ({
          quickAction: input.quickAction,
        } as unknown as RemoteAgentExternalToolEnv["BROWSER"])
      : undefined,
    OPENMELD_OBSERVABILITY: input.writeDataPoint
      ? ({ writeDataPoint: input.writeDataPoint } as AnalyticsEngineDataset)
      : undefined,
    OPENMELD_SPACE_ATTACHMENTS:
      input.bucket as RemoteAgentExternalToolEnv["OPENMELD_SPACE_ATTACHMENTS"],
  };
}

function missingContext(): never {
  throw new Error("Expected a persisted callback context.");
}

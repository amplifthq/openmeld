import { WorkerEntrypoint } from "cloudflare:workers";

export const COMPUTER_PREVIEW_HOST = "computer-preview.example.test";
const BROWSER_TIMEOUT_MS = 30_000;

export type PreviewBrowserBinding = {
  launch(options: {
    outboundByHost: Record<string, Fetcher>;
  }): Promise<{ sessionId: string; webSocket: Fetcher }>;
  closeSession(sessionId: string): Promise<unknown>;
};

type PreviewProps = { computerId: string; port: number };

export class ComputerPreviewOutbound extends WorkerEntrypoint<
  { AGENT_COMPUTER: DurableObjectNamespace },
  PreviewProps
> {
  override async fetch(request: Request): Promise<Response> {
    const { computerId, port } = this.ctx.props;
    const computer = this.env.AGENT_COMPUTER.get(
      this.env.AGENT_COMPUTER.idFromString(computerId)
    );
    const url = new URL(request.url);
    const forwarded = new Request(
      `http://computer.internal/__preview/${port}${url.pathname}${url.search}`,
      { method: request.method, headers: request.headers, body: request.body }
    );
    return await computer.fetch(forwarded);
  }
}

type CdpMessage = {
  id?: number;
  sessionId?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
};

function createCdp(socket: WebSocket) {
  let nextId = 0;
  const events: CdpMessage[] = [];
  const onEvent = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.method) {
      events.push(message);
    }
  };
  socket.addEventListener("message", onEvent);
  return {
    events,
    async send(method: string, params: object = {}, sessionId?: string) {
      const id = ++nextId;
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Browser command ${method} timed out.`));
        }, BROWSER_TIMEOUT_MS);
        const cleanup = () => {
          clearTimeout(timeout);
          socket.removeEventListener("message", onMessage);
          socket.removeEventListener("close", onClose);
        };
        const onClose = () => {
          cleanup();
          reject(
            new Error("Browser connection closed before the page was checked.")
          );
        };
        const onMessage = (event: MessageEvent) => {
          const message = JSON.parse(String(event.data)) as CdpMessage;
          if (message.id !== id) {
            return;
          }
          cleanup();
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result ?? {});
          }
        };
        socket.addEventListener("message", onMessage);
        socket.addEventListener("close", onClose);
        try {
          socket.send(JSON.stringify({ id, method, params, sessionId }));
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    },
    dispose: () => socket.removeEventListener("message", onEvent),
  };
}

export function validateComputerPreviewPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("Preview port must be between 1024 and 65535.");
  }
}

export async function inspectComputerPreview(input: {
  browser: PreviewBrowserBinding;
  computerId: string;
  ctx: DurableObjectState;
  expectedText: string;
  path: string;
  port: number;
}): Promise<{
  matched: boolean;
  pageText: string;
  browserErrors: string[];
  url: string;
}> {
  validateComputerPreviewPort(input.port);
  if (!input.path.startsWith("/") || input.path.startsWith("//")) {
    throw new Error("Preview path must start with one slash.");
  }
  const url = `http://${COMPUTER_PREVIEW_HOST}${input.path}`;
  if (new URL(url).hostname !== COMPUTER_PREVIEW_HOST) {
    throw new Error("Preview path must stay on the private preview host.");
  }
  const outbound = input.ctx.exports.ComputerPreviewOutbound({
    props: { computerId: input.computerId, port: input.port },
  });
  const connection = await input.browser.launch({
    outboundByHost: { [COMPUTER_PREVIEW_HOST]: outbound },
  });
  let socket: WebSocket | undefined;
  try {
    const response = await connection.webSocket.fetch(
      "https://browser-binding.invalid",
      { headers: { Upgrade: "websocket" } }
    );
    if (!response.webSocket) {
      throw new Error("Browser Run returned no WebSocket.");
    }
    socket = response.webSocket;
    socket.accept();
    const cdp = createCdp(socket);
    try {
      const { targetId } = await cdp.send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      if (typeof sessionId !== "string") {
        throw new Error("Browser Run did not attach to the preview page.");
      }
      await cdp.send("Runtime.enable", {}, sessionId);
      const navigation = await cdp.send("Page.navigate", { url }, sessionId);
      if (typeof navigation.errorText === "string") {
        throw new Error(`Preview navigation failed: ${navigation.errorText}`);
      }
      const deadline = Date.now() + 15_000;
      let pageText = "";
      do {
        const evaluation = await cdp.send(
          "Runtime.evaluate",
          {
            expression: "document.body?.innerText ?? ''",
            returnByValue: true,
          },
          sessionId
        );
        pageText = String(
          (evaluation.result as { value?: unknown } | undefined)?.value ?? ""
        );
        if (pageText.includes(input.expectedText)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      } while (Date.now() < deadline);
      const browserErrors = cdp.events
        .filter((event) => event.method === "Runtime.exceptionThrown")
        .map((event) =>
          String(
            (event.params?.exceptionDetails as { text?: string } | undefined)
              ?.text ?? "JavaScript exception"
          )
        )
        .slice(0, 10);
      return {
        matched: pageText.includes(input.expectedText),
        pageText: pageText.slice(0, 4000),
        browserErrors,
        url,
      };
    } finally {
      cdp.dispose();
    }
  } finally {
    socket?.close();
    await input.browser.closeSession(connection.sessionId);
  }
}

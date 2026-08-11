import { MAX_PROFILE_ID_LENGTH } from "@openmeld/protocol";

const CURSOR_PATH_REGEX = /^\/cursors\/([^/]+)$/;
const DISPATCH_TRACE_PATH_REGEX = /^\/dispatches\/([^/]+)\/trace$/;
const THREAD_PATH_REGEX = /^\/threads(?:\/([^/]+)(?:\/(events|signals))?)?$/;
const RPC_STATUS_SIGNAL_PATH = "/rpc/signals/status";
const RPC_SYSTEM_NOTICE_SIGNAL_PATH = "/rpc/signals/system-notice";

export type SpaceHttpDispatchHandlers = {
  dispatchRpcStatusSignalRequest: (request: Request) => Promise<Response>;
  dispatchRpcSystemNoticeSignalRequest: (request: Request) => Promise<Response>;
  dispatchBoardRequest: (request: Request) => Promise<Response>;
  dispatchStatusRequest: (request: Request) => Promise<Response>;
  dispatchDispatchLookupRequest: (request: Request) => Promise<Response>;
  dispatchCursorRequest: (
    request: Request,
    cursorProfileId: string
  ) => Promise<Response>;
  dispatchDispatchTraceRequest: (
    request: Request,
    dispatchId: string
  ) => Promise<Response>;
  dispatchDispatchResultRequest: (request: Request) => Promise<Response>;
  dispatchActiveWakeProgressRequest: (request: Request) => Promise<Response>;
  dispatchAgentInteractionResponseRequest: (
    request: Request
  ) => Promise<Response>;
  dispatchWakeStopRequest: (request: Request) => Promise<Response>;
  dispatchWakeProgressRequest: (request: Request) => Promise<Response>;
  dispatchWakeTraceWaterfallRequest: (request: Request) => Promise<Response>;
  dispatchMessageDetailsRequest: (request: Request) => Promise<Response>;
  dispatchDiagnosticReportsRequest: (request: Request) => Promise<Response>;
  dispatchContractRequest: (request: Request) => Promise<Response>;
  dispatchIdentityDirectoryRequest: (request: Request) => Promise<Response>;
  dispatchMemberDirectoryRequest: (request: Request) => Promise<Response>;
  dispatchMembersRequest: (request: Request) => Promise<Response>;
  dispatchRemoveMembersRequest: (request: Request) => Promise<Response>;
  dispatchLeaveSpaceRequest: (request: Request) => Promise<Response>;
  dispatchSpaceDeleteRequest: (request: Request) => Promise<Response>;
  handleWebSocket: (request: Request) => Promise<Response>;
  dispatchSignalsRequest: (request: Request) => Promise<Response>;
  dispatchUpdatesRequest: (request: Request) => Promise<Response>;
  dispatchThreadsRequest: (
    request: Request,
    threadId: string | null,
    child: "events" | "signals" | null
  ) => Promise<Response>;
  dispatchMetaRequest: (request: Request) => Promise<Response>;
  dispatchInitializeMetaRequest: (request: Request) => Promise<Response>;
  dispatchInitializeMetaWithPasswordRequest: (
    request: Request
  ) => Promise<Response>;
  dispatchPasswordRequest: (request: Request) => Promise<Response>;
  dispatchAccessModeRequest: (request: Request) => Promise<Response>;
  notFound: () => Promise<Response>;
};

export function dispatchSpaceHttpRequest(input: {
  pathName: string;
  request: Request;
  handlers: SpaceHttpDispatchHandlers;
}): Promise<Response> {
  const cursorProfileId = parseCursorProfileIdFromPath(input.pathName);
  if (cursorProfileId) {
    return input.handlers.dispatchCursorRequest(input.request, cursorProfileId);
  }

  const dispatchId = parseDispatchTraceIdFromPath(input.pathName);
  if (dispatchId) {
    return input.handlers.dispatchDispatchTraceRequest(
      input.request,
      dispatchId
    );
  }

  const threadPath = parseThreadPath(input.pathName);
  if (threadPath) {
    return input.handlers.dispatchThreadsRequest(
      input.request,
      threadPath.threadId,
      threadPath.child
    );
  }

  switch (input.pathName) {
    case RPC_STATUS_SIGNAL_PATH:
      return input.handlers.dispatchRpcStatusSignalRequest(input.request);
    case RPC_SYSTEM_NOTICE_SIGNAL_PATH:
      return input.handlers.dispatchRpcSystemNoticeSignalRequest(input.request);
    case "/dispatches/lookup":
      return input.handlers.dispatchDispatchLookupRequest(input.request);
    case "/space":
      return input.handlers.dispatchSpaceDeleteRequest(input.request);
    case "/stream":
      return input.handlers.handleWebSocket(input.request);
    case "/signals":
      return input.handlers.dispatchSignalsRequest(input.request);
    case "/updates":
      return input.handlers.dispatchUpdatesRequest(input.request);
    case "/members":
      return input.handlers.dispatchMembersRequest(input.request);
    case "/member-directory":
      return input.handlers.dispatchMemberDirectoryRequest(input.request);
    case "/identity-directory":
      return input.handlers.dispatchIdentityDirectoryRequest(input.request);
    case "/members/remove":
      return input.handlers.dispatchRemoveMembersRequest(input.request);
    case "/leave":
      return input.handlers.dispatchLeaveSpaceRequest(input.request);
    case "/meta":
      return input.handlers.dispatchMetaRequest(input.request);
    case "/contract":
      return input.handlers.dispatchContractRequest(input.request);
    case "/board":
      return input.handlers.dispatchBoardRequest(input.request);
    case "/status":
      return input.handlers.dispatchStatusRequest(input.request);
    case "/result":
      return input.handlers.dispatchDispatchResultRequest(input.request);
    case "/active-wake-progress":
      return input.handlers.dispatchActiveWakeProgressRequest(input.request);
    case "/agent-interactions/respond":
      return input.handlers.dispatchAgentInteractionResponseRequest(
        input.request
      );
    case "/wake-stop":
      return input.handlers.dispatchWakeStopRequest(input.request);
    case "/wake-progress":
      return input.handlers.dispatchWakeProgressRequest(input.request);
    case "/wake-trace-waterfall":
      return input.handlers.dispatchWakeTraceWaterfallRequest(input.request);
    case "/message-details":
      return input.handlers.dispatchMessageDetailsRequest(input.request);
    case "/diagnostic-reports":
      return input.handlers.dispatchDiagnosticReportsRequest(input.request);
    case "/meta/init":
      return input.handlers.dispatchInitializeMetaRequest(input.request);
    case "/meta/init-with-password":
      return input.handlers.dispatchInitializeMetaWithPasswordRequest(
        input.request
      );
    case "/password":
      return input.handlers.dispatchPasswordRequest(input.request);
    case "/access-mode":
      return input.handlers.dispatchAccessModeRequest(input.request);
    default:
      return input.handlers.notFound();
  }
}

export function parseCursorProfileIdFromPath(pathname: string): string | null {
  const match = pathname.match(CURSOR_PATH_REGEX);
  if (!match) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(match[1] ?? "").trim();
    if (decoded.length === 0 || decoded.length > MAX_PROFILE_ID_LENGTH) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function parseDispatchTraceIdFromPath(pathname: string): string | null {
  const match = pathname.match(DISPATCH_TRACE_PATH_REGEX);
  if (!match) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(match[1] ?? "").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function parseThreadPath(
  pathname: string
): { threadId: string | null; child: "events" | "signals" | null } | null {
  const match = pathname.match(THREAD_PATH_REGEX);
  if (!match) {
    return null;
  }

  try {
    const rawThreadId = match[1];
    const threadId = rawThreadId
      ? decodeURIComponent(rawThreadId).trim()
      : null;
    const child =
      match[2] === "events" || match[2] === "signals" ? match[2] : null;
    if (rawThreadId && !threadId) {
      return null;
    }
    return { threadId, child };
  } catch {
    return null;
  }
}

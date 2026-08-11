export type FetchRequestInput = string | URL | Request;
const OBSERVED_METADATA_PATH_PATTERN =
  /^\/v1\/devices\/[^/]+\/observed-metadata$/u;
const LOCAL_RUNTIME_ENROLLMENT_PATH_PATTERN =
  /^\/v1\/local-runtimes\/([^/]+)\/enrollment$/u;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function parseJsonBody(body: RequestInit["body"] | null | undefined): unknown {
  if (typeof body !== "string") {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

export function resolveRequestUrl(input: FetchRequestInput): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

export function createStartFetchHandler(version: string) {
  return (input: FetchRequestInput, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const pathname = new URL(url).pathname;
    const method = init?.method ?? "GET";

    const currentDeviceResponse = handleCurrentDeviceRequest({
      body: init?.body,
      method,
      pathname,
    });
    if (currentDeviceResponse) {
      return currentDeviceResponse;
    }

    if (OBSERVED_METADATA_PATH_PATTERN.test(pathname) && method === "PUT") {
      return jsonResponse(parseJsonBody(init?.body));
    }

    const enrollmentResponse = handleLocalRuntimeEnrollmentRequest({
      body: init?.body,
      method,
      pathname,
    });
    if (enrollmentResponse) {
      return enrollmentResponse;
    }

    if (pathname === "/v1/version" && method === "GET") {
      return jsonResponse({ version });
    }

    throw new Error(
      `Unexpected fetch request in start test helper: ${method} ${pathname}`
    );
  };
}

function handleLocalRuntimeEnrollmentRequest(input: {
  body: RequestInit["body"] | null | undefined;
  method: string;
  pathname: string;
}): Response | null {
  const match = LOCAL_RUNTIME_ENROLLMENT_PATH_PATTERN.exec(input.pathname);
  if (!match) {
    return null;
  }

  if (input.method !== "POST") {
    return null;
  }

  const rawDeviceId = match[1];
  if (rawDeviceId === undefined) {
    return null;
  }
  const deviceId = decodeURIComponent(rawDeviceId);
  const body = parseJsonBody(input.body);
  const runtimeLane =
    typeof (body as { runtimeLane?: unknown }).runtimeLane === "string"
      ? String((body as { runtimeLane: string }).runtimeLane)
      : "dev-local";
  const connectedComputerId = (body as { connectedComputerId?: unknown })
    .connectedComputerId;

  return jsonResponse({
    deviceId,
    runtimeLane,
    ...(typeof connectedComputerId === "string" ? { connectedComputerId } : {}),
  });
}

function handleCurrentDeviceRequest(input: {
  body: RequestInit["body"] | null | undefined;
  method: string;
  pathname: string;
}): Response | null {
  if (input.pathname !== "/v1/devices/current") {
    return null;
  }

  if (input.method === "GET") {
    return jsonResponse({ availability: "missing" });
  }

  if (input.method !== "PUT") {
    return null;
  }

  const body = parseJsonBody(input.body);
  const deviceId =
    typeof (body as { deviceId?: unknown }).deviceId === "string"
      ? String((body as { deviceId: string }).deviceId)
      : "device-under-test";
  const runtimeLane =
    typeof (body as { runtimeLane?: unknown }).runtimeLane === "string"
      ? String((body as { runtimeLane: string }).runtimeLane)
      : "dev-local";

  return jsonResponse({
    availability: "resolved",
    deviceId,
    runtimeLane,
  });
}

import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createSecureServer } from "node:http2";
import { join } from "node:path";

// Captured Cursor 2026.09.18-9a7762b Connect/protobuf fixture. It scripts only
// the model boundary; the installed executable runs its real ACP/tools/hooks.
function varint(value) {
  const bytes = [];
  let rest = value;
  do {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    bytes.push(byte + (rest ? 128 : 0));
  } while (rest);
  return Buffer.from(bytes);
}

function field(number, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
}

function scalar(number, value) {
  return Buffer.concat([varint(number * 8), varint(value)]);
}

function fields(bytes) {
  let position = 0;
  function readVarint() {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      if (position >= bytes.length || shift > 49) {
        throw new Error("Malformed fixture varint");
      }
      byte = bytes[position++];
      value += (byte % 128) * 2 ** shift;
      shift += 7;
    } while (byte >= 128);
    return value;
  }
  const result = [];
  while (position < bytes.length) {
    const key = readVarint();
    const wire = key % 8;
    let value;
    if (wire === 2) {
      const length = readVarint();
      if (position + length > bytes.length) {
        throw new Error("Malformed fixture field");
      }
      value = bytes.subarray(position, position + length);
      position += length;
    } else if (wire === 0) {
      value = readVarint();
    } else if (wire === 1) {
      position += 8;
    } else if (wire === 5) {
      position += 4;
    } else {
      throw new Error("Unsupported fixture wire type");
    }
    result.push([Math.floor(key / 8), value]);
  }
  return result;
}

function frame(bytes) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}

function finishResponse(response) {
  response.write(
    frame(field(1, field(1, field(1, "Synthetic delivery completed."))))
  );
  response.write(frame(field(1, field(14, Buffer.alloc(0)))));
  response.end(Buffer.from([2, 0, 0, 0, 2, 123, 125]));
}

function deliveryRequest(tool, command, workdir) {
  if (command) {
    return field(
      2,
      Buffer.concat([
        scalar(1, 1),
        field(15, "exec-shell"),
        field(
          2,
          Buffer.concat([
            field(1, command),
            field(2, workdir),
            field(4, "call-shell"),
          ])
        ),
      ])
    );
  }
  const get = (number) =>
    tool.find(([key]) => key === number)?.[1]?.toString() ?? "";
  return field(
    2,
    Buffer.concat([
      scalar(1, 2),
      field(15, "exec-mcp"),
      field(
        11,
        Buffer.concat([
          field(1, get(1)),
          field(
            2,
            Buffer.concat([
              field(1, "message"),
              field(2, field(3, "I cannot access the repository.")),
            ])
          ),
          field(3, "call-reply"),
          field(4, get(4)),
          field(5, get(5)),
          field(9, "openmeld_internal_dispatch_space_action"),
        ])
      ),
    ])
  );
}

function readReplyTool(message, evidence) {
  const run = message.find(([number]) => number === 1)?.[1];
  const list = fields(run).find(([number]) => number === 4)?.[1];
  const tools = list ? fields(list).map(([, value]) => fields(value)) : [];
  evidence.catalogs.push(
    tools.map((entry) => entry.find(([number]) => number === 1)?.[1].toString())
  );
  const tool = tools.find((entry) =>
    entry.some(
      ([number, value]) => number === 5 && value.toString() === "reply"
    )
  );
  if (!tool) {
    throw new Error("Native model request omitted reply");
  }
  return tool;
}

function handleRun(request, response, evidence, options) {
  response.setHeader("content-type", "application/connect+proto");
  let buffer = Buffer.alloc(0);
  let phase = 0;
  let tool;
  const handleMessage = (message) => {
    if (phase === 0) {
      tool = readReplyTool(message, evidence);
      phase = options.command ? 1 : 2;
      response.write(
        frame(deliveryRequest(tool, options.command, options.workdir))
      );
      return;
    }
    const result = message.find(([number]) => number === 2)?.[1];
    if (!result) {
      return;
    }
    evidence.results.push(result.toString("hex"));
    if (phase === 1) {
      phase = 2;
      response.write(frame(deliveryRequest(tool)));
    } else if (phase === 2) {
      phase = 3;
      finishResponse(response);
    }
  };
  request.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    try {
      while (
        buffer.length >= 5 &&
        buffer.length >= 5 + buffer.readUInt32BE(1)
      ) {
        const length = buffer.readUInt32BE(1);
        const message = fields(buffer.subarray(5, 5 + length));
        buffer = buffer.subarray(5 + length);
        handleMessage(message);
      }
    } catch (error) {
      evidence.errors.push(String(error));
      response.destroy(error);
    }
  });
}

export async function createDeliveryProvider(home, options = {}) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(home, "key.pem"),
      "-out",
      join(home, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" }
  );
  const evidence = { catalogs: [], results: [], errors: [] };
  const server = createSecureServer(
    {
      allowHTTP1: true,
      key: await readFile(join(home, "key.pem")),
      cert: await readFile(join(home, "cert.pem")),
    },
    (request, response) => {
      if (request.url.endsWith("/Run")) {
        handleRun(request, response, evidence, options);
        return;
      }
      request.resume();
      request.on("end", () => {
        response.setHeader("content-type", "application/proto");
        if (request.url.endsWith("/AvailableModels")) {
          response.end(
            field(
              2,
              Buffer.concat([
                field(1, "fixture"),
                scalar(2, 1),
                scalar(5, 1),
                scalar(22, 1),
              ])
            )
          );
        } else if (
          request.url.endsWith("/GetDefaultModelForCli") ||
          request.url.endsWith("/GetUsableModels")
        ) {
          response.end(
            field(1, Buffer.concat([field(1, "fixture"), field(4, "Fixture")]))
          );
        } else {
          response.end(Buffer.alloc(0));
        }
      });
    }
  );
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    endpoint: `https://127.0.0.1:${server.address().port}`,
    evidence,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  describeDispatchSpaceTools,
  OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES,
} from "@openmeld/adapter-core";
import { z } from "zod/v4";

export function capability(deliveryOnly = false) {
  const names = deliveryOnly
    ? ["reply", "stay_silent", "read_receipt"]
    : OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES;
  return {
    deliveryOnly,
    tools: names.map((name) => ({
      name,
      description: `Synthetic ${name} fixture.`,
      inputSchema: fixtureSchema(name),
    })),
    call: () =>
      Promise.reject(
        new Error("The native shim must use the shared MCP service.")
      ),
    close() {
      /* Schema fixture: the native shim owns its process. */
    },
  };
}

function fixtureSchema(name) {
  if (name === "reply") {
    return z.strictObject({ message: z.string().min(1) });
  }
  if (name === "stay_silent") {
    return z.strictObject({ reason: z.string().min(1) });
  }
  return z.strictObject({});
}

export async function writeSpaceToolFixture(home, deliveryOnly = false) {
  const command = join(home, "openmeld");
  const capture = join(home, "calls.jsonl");
  const receipt = join(home, "receipt.json");
  const definitions = describeDispatchSpaceTools(capability(deliveryOnly));
  await writeFile(
    command,
    `#!${process.execPath}\nconst definitions = ${JSON.stringify(definitions)};\nconst capture=${JSON.stringify(capture)};\nconst receiptPath=${JSON.stringify(receipt)};\n${String.raw`
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
appendFileSync(capture, JSON.stringify({ started: true, argv: process.argv.slice(2) }) + "\n");
let stored;try {stored=JSON.parse(readFileSync(receiptPath,"utf8"));}catch{}
createInterface({input:process.stdin}).on("line",line=>{
  const request=JSON.parse(line);if(request.id===undefined)return;
  let result;
  if(request.method==="initialize") result={protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"fixture",version:"1"}};
  else if(request.method==="tools/list") result={tools:definitions};
  else if(request.method==="tools/call") {
    appendFileSync(capture,JSON.stringify(request.params)+"\n");
    const {name,arguments:args}=request.params;
    if(name==="reply" && !args.message) result={isError:true,content:[{type:"text",text:"message is required. This call was rejected before recording; correct the input."}],structuredContent:{receipt:{status:"rejected_before_recording"}}};
    else if(name==="read_history" || name==="read_result") result={content:[{type:"text",text:"Large fixture result."}],structuredContent:{result:{text:"complete-"+"😀".repeat(10000)+"-end"}}};
    else if(name==="read_receipt") result={content:[{type:"text",text:stored?"Existing receipt.":"No local final action record is present."}],...(stored?{structuredContent:{receipt:stored}}:{})};
    else {
      stored??={status:"proposal_saved_locally",actionType:name==="reply"?"post_message":"stay_silent",publication:"unconfirmed",message:args.message};
      writeFileSync(receiptPath,JSON.stringify(stored));
      if(args.message==="lose the receipt") {process.exit(0);return;}
      result={content:[{type:"text",text:"Saved locally; publication is unconfirmed."}],structuredContent:{receipt:stored}};
    }
  } else result={};
  process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result})+"\n");
});
`}`
  );
  await chmod(command, 0o700);
  return { command, capture, receipt, definitions };
}

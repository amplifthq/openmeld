import { describe, expect, it } from "vitest";
import {
  inspectAssistantPublicationProtocol,
  inspectStreamingAssistantPublicationProtocol,
} from "../agent-core/assistant-publication";

describe("assistant publication protocol boundary", () => {
  it("recognizes reserved provider protocol without interpreting it as a call", () => {
    expect(
      inspectAssistantPublicationProtocol(
        "I'll check that now. <tool_call>openmeld_list_app_actions"
      )
    ).toEqual({ marker: "tool_call", status: "contaminated" });
    expect(inspectAssistantPublicationProtocol("Waiting for <tool_")).toEqual({
      marker: "tool_call",
      status: "incomplete",
    });
  });

  it("recognizes character references that render as reserved protocol", () => {
    expect(
      inspectAssistantPublicationProtocol(
        "I'll check that now. &lt;tool_call&gt;openmeld_list_app_actions"
      )
    ).toEqual({ marker: "tool_call", status: "contaminated" });
    expect(
      inspectAssistantPublicationProtocol(
        "I'll check that now. &#60;t&#111;ol_call&#62;openmeld_list_app_actions"
      )
    ).toEqual({ marker: "tool_call", status: "contaminated" });
    expect(
      inspectAssistantPublicationProtocol(
        "I'll check that now. &lt;tool&lowbar;call&gt;openmeld_list_app_actions"
      )
    ).toEqual({ marker: "tool_call", status: "contaminated" });
    expect(
      inspectAssistantPublicationProtocol(
        "I'll check that now. &LT;tool&UnderBar;call&GT;openmeld_list_app_actions"
      )
    ).toEqual({ marker: "tool_call", status: "contaminated" });
  });

  it("recognizes every standard named whitespace reference at a protocol boundary", () => {
    const whitespaceReferences = [
      "MediumSpace",
      "NewLine",
      "NonBreakingSpace",
      "Tab",
      "ThickSpace",
      "ThinSpace",
      "VeryThinSpace",
      "emsp13",
      "emsp14",
      "emsp",
      "ensp",
      "hairsp",
      "nbsp",
      "numsp",
      "puncsp",
      "thinsp",
    ];

    for (const reference of whitespaceReferences) {
      expect(
        inspectAssistantPublicationProtocol(
          `&lt;tool_call&${reference};openmeld_list_spaces`
        )
      ).toEqual({ marker: "tool_call", status: "contaminated" });
    }
  });

  it("allows ordinary angle-bracket text outside the reserved protocol grammar", () => {
    expect(
      inspectAssistantPublicationProtocol(
        "Use <button> for the control and compare x < y."
      )
    ).toEqual({ status: "publishable" });
  });

  it("allows protocol examples that complete Markdown renders as code", () => {
    expect(
      inspectAssistantPublicationProtocol(
        "Use `<tool_call>` only as an example, not as a real call."
      )
    ).toEqual({ status: "publishable" });
    expect(
      inspectAssistantPublicationProtocol(
        "Use `&lt;tool&lowbar;call&gt;` to show the escaped source."
      )
    ).toEqual({ status: "publishable" });
    expect(
      inspectAssistantPublicationProtocol("```text\n<tool_call>example\n```")
    ).toEqual({ status: "publishable" });
    expect(
      inspectAssistantPublicationProtocol(
        "~~~text\n&lt;tool&lowbar;call&gt;example\n~~~"
      )
    ).toEqual({ status: "publishable" });
  });

  it("repairs incomplete inline code only for Web-compatible stream snapshots", () => {
    const text = "The streaming example is still open: `<tool_call>";

    expect(inspectAssistantPublicationProtocol(text)).toEqual({
      marker: "tool_call",
      status: "contaminated",
    });
    expect(inspectStreamingAssistantPublicationProtocol(text)).toEqual({
      status: "publishable",
    });
  });

  it("resumes protocol inspection after a CRLF fenced code block", () => {
    expect(
      inspectAssistantPublicationProtocol(
        "```text\r\nexample\r\n```\r\n<tool_call>openmeld_list_app_actions"
      )
    ).toEqual({ marker: "tool_call", status: "contaminated" });
  });

  it("does not let backtick runs inside code mask later prose", () => {
    expect(
      inspectAssistantPublicationProtocol(
        "`code `` inner` <tool_call>openmeld_list_app_actions ``"
      )
    ).toEqual({ marker: "tool_call", status: "contaminated" });
  });

  it("does not mask prose with invalid or container-sensitive code syntax", () => {
    const proseCases = [
      "```foo`\n<tool_call>openmeld_list_app_actions\n```",
      "- Step\n    <tool_call>openmeld_list_app_actions",
      "\\` code <tool_call>openmeld_list_app_actions \\`",
    ];

    for (const text of proseCases) {
      expect(inspectAssistantPublicationProtocol(text)).toEqual({
        marker: "tool_call",
        status: "contaminated",
      });
    }
  });

  it("handles a large malformed character-reference sequence as ordinary text", () => {
    const malformedReferences = `${"&".repeat(50_000)};`;
    expect(inspectAssistantPublicationProtocol(malformedReferences)).toEqual({
      status: "publishable",
    });
  });
});

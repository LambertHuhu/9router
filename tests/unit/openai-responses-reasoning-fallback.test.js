import { describe, expect, it } from "vitest";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

function feed(chunks, stateOverrides = {}) {
  const state = { ...initState(FORMATS.OPENAI_RESPONSES), ...stateOverrides };
  const events = [];
  for (const chunk of chunks) {
    const out = openaiToOpenAIResponsesResponse(chunk, state);
    if (out) events.push(...out);
  }
  return events;
}

function completedOutput(events) {
  return events.find(event => event.event === "response.completed")?.data?.response?.output || [];
}

function messageText(output) {
  const item = output.find(entry => entry.type === "message");
  return (item?.content || []).map(part => part.text || "").join("");
}

function reasoningText(output) {
  const item = output.find(entry => entry.type === "reasoning");
  return (item?.summary || []).map(part => part.text || "").join("");
}

describe("openai-responses reasoning fallback", () => {
  it("does not append reasoning text to a message that already has content", () => {
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { reasoning_content: "Let me verify the file." } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "Final answer." } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "", reasoning_content: null }, finish_reason: "stop" }],
      },
    ]);

    const output = completedOutput(events);
    expect(messageText(output)).toBe("Final answer.");
    expect(reasoningText(output)).toBe("Let me verify the file.");
  });

  it("keeps the DeepSeek fallback when reasoning is the only output", () => {
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { reasoning_content: "Only reasoning output." } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "", reasoning_content: null }, finish_reason: "stop" }],
      },
    ]);

    const output = completedOutput(events);
    expect(messageText(output)).toBe("Only reasoning output.");
    expect(reasoningText(output)).toBe("Only reasoning output.");
  });

  it("does not turn reasoning-only stop into a message when tools are available", () => {
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { reasoning_content: "I should inspect files next." } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "", reasoning_content: null }, finish_reason: "stop" }],
      },
    ], { requestHasTools: true });

    const output = completedOutput(events);
    expect(messageText(output)).toBe("");
    expect(reasoningText(output)).toBe("I should inspect files next.");
  });

  it("does not promote Chinese action-plan reasoning into a message", () => {
    const actionPlan = "先改 P14（入站冗余消除），按 A1→A2→A3 执行。P14.1 A1：HandleAudioChunk 中 audio_header 栈上 copy 去掉。";
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { reasoning_content: actionPlan } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "", reasoning_content: null }, finish_reason: "stop" }],
      },
    ], { requestHasTools: true });

    const output = completedOutput(events);
    expect(messageText(output)).toBe("");
    expect(reasoningText(output)).toBe(actionPlan);
  });

  it("does not promote Codex-style explored/search status text into a final message", () => {
    const progressText = "Explored\n└ Search class.*DirectionalWsSession|struct.*DirectionalWsSession";
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: progressText } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
      },
    ], { requestHasTools: true });

    const output = completedOutput(events);
    expect(messageText(output)).toBe("");
  });

  it("does not promote low-information DeepSeek placeholders into a message", () => {
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { reasoning_content: " 响应" } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "", reasoning_content: null }, finish_reason: "stop" }],
      },
    ], { requestHasTools: true });

    const output = completedOutput(events);
    expect(messageText(output)).toBe("");
    expect(reasoningText(output)).toBe(" 响应");
  });

  it("suppresses action preamble content when the same tool-session response emits a tool call", () => {
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "P15: B1 入站零拷贝。`RuntimeAudioChunk::payload` 数组改指针。" } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_read_audio_chunk_pool",
              type: "function",
              function: { name: "exec_command", arguments: "{\"cmd\":\"sed -n '11,24p' MediaOrchestration/AudioChunkPool.h\"}" },
            }],
          },
        }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
    ], { requestHasTools: true });

    const output = completedOutput(events);
    expect(messageText(output)).toBe("");
    expect(output.some(entry => entry.type === "function_call" && entry.name === "exec_command")).toBe(true);
  });

  it("flushes buffered answer content on stop when tools are available but no tool call is emitted", () => {
    const finalAnswer = "P14 完成。压测通过，30/30 FSM 成功，0 错误。";
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: finalAnswer } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
      },
    ], { requestHasTools: true });

    const output = completedOutput(events);
    expect(messageText(output)).toBe(finalAnswer);
  });

  it("promotes answer-like reasoning-only stop into a message even when tools are available", () => {
    const finalAnswer = "关键字段：\\n- magic = 0x46534132\\n- message_type = 3（AUDIO_CHUNK）\\n所有多字节字段在 P12 后使用宿主机小端。";
    const events = feed([
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { reasoning_content: finalAnswer } }],
      },
      {
        id: "chatcmpl-test",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "", reasoning_content: null }, finish_reason: "stop" }],
      },
    ], { requestHasTools: true });

    const output = completedOutput(events);
    expect(messageText(output)).toBe(finalAnswer);
    expect(reasoningText(output)).toBe(finalAnswer);
  });
});

describe("openai-responses tool request sanitation", () => {
  it("removes stale placeholder/action-preamble assistant messages and adds DeepSeek tool-result continuation guard", () => {
    const body = {
      input: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: " 响应" }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "继续" }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "P15: B1 入站零拷贝。`RuntimeAudioChunk::payload` 数组改指针。" }],
        },
        {
          type: "function_call",
          call_id: "call_read_audio_chunk_pool",
          name: "exec_command",
          arguments: "{\"cmd\":\"grep payload\"}",
        },
        {
          type: "function_call_output",
          call_id: "call_read_audio_chunk_pool",
          output: "MediaOrchestration/AudioChunkPool.h:21: uint8_t payload[kAudioChunkPayloadBytes];",
        },
      ],
      tools: [{ type: "function", name: "exec_command", parameters: { type: "object", properties: {} } }],
    };

    const target = openaiResponsesToOpenAIRequest("deepseek-v4-pro", body, true, null);
    const assistantTexts = target.messages
      .filter(msg => msg.role === "assistant" && !msg.tool_calls)
      .map(msg => typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));

    expect(assistantTexts.some(text => text.includes("响应"))).toBe(false);
    expect(assistantTexts.some(text => text.includes("P15: B1"))).toBe(false);
    expect(target.messages.at(-1).role).toBe("user");
    expect(target.messages.at(-1).content).toContain("9router tool-result continuation:");
  });

  it("removes stale Codex-style explored/search progress messages before the next tool turn", () => {
    const body = {
      input: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Explored\n└ Search class.*DirectionalWsSession|struct.*DirectionalWsSession" }],
        },
        {
          type: "function_call",
          call_id: "call_find_header",
          name: "exec_command",
          arguments: "{\"cmd\":\"find . -name '*.h'\"}",
        },
      ],
      tools: [{ type: "function", name: "exec_command", parameters: { type: "object", properties: {} } }],
    };

    const target = openaiResponsesToOpenAIRequest("deepseek-v4-pro", body, true, null);
    const assistantTexts = target.messages
      .filter(msg => msg.role === "assistant" && !msg.tool_calls)
      .map(msg => typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));

    expect(assistantTexts.some(text => text.includes("Explored"))).toBe(false);
  });
});

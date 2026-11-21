import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import type { ModelDef } from "./models";
import { readHelixMd, type PermissionMode, type ToolCall, approvalKey } from "./sessions";
import { TOOL_DEFS, needsApproval, runTool, openaiTools } from "./tools";

export type AgentEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "tool_start"; tool: ToolCall }
  | { type: "tool_awaiting"; tool: ToolCall }
  | { type: "tool_result"; tool: ToolCall }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

const MAX_ROUNDS = 12;

function systemPrompt(mode: PermissionMode) {
  return `You are Helix, a coding agent harness inspired by terminal coding agents.
Work only inside the provided sandbox via tools. Prefer small, correct edits.
Permission mode: ${mode}.
- plan: explore and propose; do not write files or run bash.
- manual: ask (via write_file/bash tools) — the host may pause for approval.
- accept_edits: file writes are auto-approved; bash still needs approval.

Be concise. After edits, note how to verify. Never invent file contents — read first.`;
}

export async function* runLlmAgentTurn(opts: {
  prompt: string;
  mode: PermissionMode;
  model: ModelDef;
  history?: { role: "user" | "assistant"; content: string }[];
  approvals?: Record<string, "allow" | "deny">;
}): AsyncGenerator<AgentEvent> {
  const helix = await readHelixMd();
  const sys = `${systemPrompt(opts.mode)}\n\n# HELIX.md\n${helix || "(empty)"}`;

  if (opts.mode === "plan" && /fix|write|edit|change|patch/i.test(opts.prompt)) {
    // Still allow LLM in plan mode — tools that write will be blocked below.
  }

  if (opts.model.provider === "anthropic") {
    yield* runAnthropic(opts, sys);
    return;
  }
  if (opts.model.provider === "openai" || opts.model.provider === "openrouter") {
    yield* runOpenAICompat(opts, sys);
    return;
  }
  yield { type: "error", message: `Unsupported provider: ${opts.model.provider}` };
}

async function* runAnthropic(
  opts: {
    prompt: string;
    mode: PermissionMode;
    model: ModelDef;
    history?: { role: "user" | "assistant"; content: string }[];
    approvals?: Record<string, "allow" | "deny">;
  },
  sys: string,
): AsyncGenerator<AgentEvent> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [];
  for (const h of opts.history ?? []) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: opts.prompt });

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({
      model: opts.model.id,
      max_tokens: 4096,
      system: sys,
      tools: TOOL_DEFS,
      messages,
    });

    const toolUses: Anthropic.ToolUseBlock[] = [];
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
        yield { type: "assistant_delta", text: block.text };
      } else if (block.type === "tool_use") {
        toolUses.push(block);
      }
    }

    if (toolUses.length === 0) {
      if (!text) yield { type: "assistant_delta", text: "(no response)" };
      yield { type: "done", summary: "ok" };
      return;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const use of toolUses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      const tool: ToolCall = {
        id: use.id || randomUUID(),
        name: use.name,
        input,
        status: "running",
      };

      if (opts.mode === "plan" && (use.name === "write_file" || use.name === "bash")) {
        tool.status = "denied";
        tool.output = "Blocked in plan mode";
        yield { type: "tool_result", tool };
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: tool.output,
          is_error: true,
        });
        continue;
      }

      if (needsApproval(use.name, opts.mode)) {
        const decision = opts.approvals?.[approvalKey({ name: use.name, input })];
        if (!decision) {
          tool.status = "awaiting_approval";
          yield { type: "tool_awaiting", tool };
          yield { type: "done", summary: "awaiting_permission" };
          return;
        }
        if (decision === "deny") {
          tool.status = "denied";
          tool.output = "Denied by user";
          yield { type: "tool_result", tool };
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: tool.output,
            is_error: true,
          });
          continue;
        }
      }

      yield { type: "tool_start", tool };
      try {
        tool.output = await runTool(use.name, input);
        tool.status = "done";
        yield { type: "tool_result", tool };
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: tool.output.slice(0, 80_000),
        });
      } catch (err) {
        tool.status = "error";
        tool.output = err instanceof Error ? err.message : String(err);
        yield { type: "tool_result", tool };
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: tool.output,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  yield {
    type: "assistant_delta",
    text: "\nStopped after too many tool rounds. Ask me to continue if needed.",
  };
  yield { type: "done", summary: "max_rounds" };
}

async function* runOpenAICompat(
  opts: {
    prompt: string;
    mode: PermissionMode;
    model: ModelDef;
    history?: { role: "user" | "assistant"; content: string }[];
    approvals?: Record<string, "allow" | "deny">;
  },
  sys: string,
): AsyncGenerator<AgentEvent> {
  const isRouter = opts.model.provider === "openrouter";
  const client = new OpenAI({
    apiKey: isRouter ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY,
    baseURL: isRouter ? "https://openrouter.ai/api/v1" : undefined,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: sys },
  ];
  for (const h of opts.history ?? []) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: opts.prompt });

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.chat.completions.create({
      model: opts.model.id,
      messages,
      tools: openaiTools(),
    });
    const msg = response.choices[0]?.message;
    if (!msg) {
      yield { type: "error", message: "Empty model response" };
      return;
    }

    if (msg.content) {
      yield { type: "assistant_delta", text: msg.content };
    }

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      yield { type: "done", summary: "ok" };
      return;
    }

    messages.push(msg);
    for (const call of calls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.function.arguments || "{}");
      } catch {
        input = {};
      }
      const tool: ToolCall = {
        id: call.id || randomUUID(),
        name,
        input,
        status: "running",
      };

      if (opts.mode === "plan" && (name === "write_file" || name === "bash")) {
        tool.status = "denied";
        tool.output = "Blocked in plan mode";
        yield { type: "tool_result", tool };
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: tool.output,
        });
        continue;
      }

      if (needsApproval(name, opts.mode)) {
        const decision = opts.approvals?.[approvalKey({ name, input })];
        if (!decision) {
          tool.status = "awaiting_approval";
          yield { type: "tool_awaiting", tool };
          yield { type: "done", summary: "awaiting_permission" };
          return;
        }
        if (decision === "deny") {
          tool.status = "denied";
          tool.output = "Denied by user";
          yield { type: "tool_result", tool };
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: tool.output,
          });
          continue;
        }
      }

      yield { type: "tool_start", tool };
      try {
        tool.output = await runTool(name, input);
        tool.status = "done";
      } catch (err) {
        tool.status = "error";
        tool.output = err instanceof Error ? err.message : String(err);
      }
      yield { type: "tool_result", tool };
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: (tool.output ?? "").slice(0, 80_000),
      });
    }
  }

  yield {
    type: "assistant_delta",
    text: "\nStopped after too many tool rounds. Ask me to continue if needed.",
  };
  yield { type: "done", summary: "max_rounds" };
}


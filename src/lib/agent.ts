import { randomUUID } from "crypto";
import { readFileSafe } from "./sandbox";
import type { PermissionMode, ToolCall } from "./sessions";
import { approvalKey } from "./sessions";
export { approvalKey } from "./sessions";
import { needsApproval, runTool } from "./tools";
import { resolveModelForRuntime, type ModelDef } from "./models";
import { runLlmAgentTurn, type AgentEvent } from "./llm-agent";
export type { AgentEvent } from "./llm-agent";

type PlannedStep =
  | { kind: "say"; text: string }
  | { kind: "tool"; name: string; input: Record<string, unknown>; needsApproval?: boolean };

function planFromPrompt(prompt: string): PlannedStep[] {
  const lower = prompt.toLowerCase();

  if (lower.startsWith("/help")) {
    return [
      {
        kind: "say",
        text: `Helix slash commands
/help — this list
/clear — clear the transcript in the UI
/permissions — cycle permission mode (manual → accept_edits → plan)
/model — cycle or pick a model
/init — ensure HELIX.md exists
/compact — summarize older turns
/tree — list the sandbox files
/resume — open the session picker
/new — start a fresh session

With an API key: Claude runs a real tool loop. Without one: demo mode still works offline.`,
      },
    ];
  }

  if (lower.startsWith("/tree") || lower.includes("list files") || lower.includes("what's in")) {
    return [
      { kind: "say", text: "Listing the sandbox project tree." },
      { kind: "tool", name: "list_files", input: { path: "." } },
      { kind: "say", text: "That is the working tree Helix can touch." },
    ];
  }

  if (lower.startsWith("/init")) {
    return [
      { kind: "say", text: "Checking project instructions." },
      { kind: "tool", name: "read_file", input: { path: "HELIX.md" } },
      { kind: "say", text: "HELIX.md is loaded every turn." },
    ];
  }

  if (lower.includes("grep") || lower.includes("search for") || lower.includes("find bug") || lower.includes("where is")) {
    const pattern = lower.includes("bug") ? "BUG|TODO|FIXME" : "function|const|let";
    return [
      { kind: "say", text: "Searching the sandbox." },
      { kind: "tool", name: "grep", input: { pattern } },
      { kind: "say", text: "Search complete." },
    ];
  }

  if (
    lower.includes("fix") &&
    (lower.includes("counter") || lower.includes("bug") || lower.includes("increment"))
  ) {
    return [
      { kind: "say", text: "I'll inspect the counter demo, find the bug, and patch it." },
      { kind: "tool", name: "read_file", input: { path: "demo/app.js" } },
      { kind: "tool", name: "grep", input: { pattern: "BUG|\\+=|\\-=" } },
      {
        kind: "tool",
        name: "write_file",
        input: {
          path: "demo/app.js",
          content: `// Fixed: increment now adds.
let value = 0;

const countEl = document.getElementById("count");
const incBtn = document.getElementById("inc");
const decBtn = document.getElementById("dec");
const resetBtn = document.getElementById("reset");

function render() {
  countEl.textContent = String(value);
}

incBtn.addEventListener("click", () => {
  value += 1;
  render();
});

decBtn.addEventListener("click", () => {
  value -= 1;
  render();
});

resetBtn.addEventListener("click", () => {
  value = 0;
  render();
});

render();
`,
        },
        needsApproval: true,
      },
      {
        kind: "say",
        text: "Fixed `demo/app.js`: the + button was subtracting. It now uses `value += 1`.",
      },
    ];
  }

  if (lower.startsWith("read ") || lower.includes("open ") || lower.includes("show me ")) {
    const match = prompt.match(/(?:read|open|show me)\s+([^\s]+)/i);
    const file = match?.[1]?.replace(/[`'"]/g, "") ?? "demo/app.js";
    return [
      { kind: "say", text: `Reading \`${file}\`.` },
      { kind: "tool", name: "read_file", input: { path: file } },
    ];
  }

  if (lower.includes("run ") || lower.startsWith("ls") || lower.includes("pwd")) {
    const command = lower.startsWith("ls")
      ? "ls"
      : lower.includes("pwd")
        ? "pwd"
        : prompt.replace(/^run\s+/i, "").trim() || "ls";
    return [
      { kind: "say", text: `Running \`${command}\`.` },
      { kind: "tool", name: "bash", input: { command }, needsApproval: true },
    ];
  }

  return [
    { kind: "say", text: "Exploring the sandbox (demo agent — add an Anthropic key for Claude)." },
    { kind: "tool", name: "list_files", input: { path: "." } },
    { kind: "tool", name: "read_file", input: { path: "HELIX.md" } },
    {
      kind: "say",
      text: "Try **fix the counter bug**, **read demo/app.js**, or **/help**.",
    },
  ];
}

async function* runDemoAgentTurn(opts: {
  prompt: string;
  mode: PermissionMode;
  approvals?: Record<string, "allow" | "deny">;
}): AsyncGenerator<AgentEvent> {
  if (opts.mode === "plan" && /fix|write|edit|change|patch/i.test(opts.prompt)) {
    yield {
      type: "assistant_delta",
      text: "Plan mode is on — I'll inspect only and propose a plan without writing files.\n\n",
    };
    const content = await readFileSafe("demo/app.js");
    const tool: ToolCall = {
      id: randomUUID(),
      name: "read_file",
      input: { path: "demo/app.js" },
      output: content,
      status: "done",
    };
    yield { type: "tool_start", tool: { ...tool, status: "running", output: undefined } };
    yield { type: "tool_result", tool };
    yield {
      type: "assistant_delta",
      text: "## Plan\n1. Confirm increment uses `-=`.\n2. Patch to `+=`.\n3. Click through +, −, Reset.\n\nSwitch mode and ask me to apply.",
    };
    yield { type: "done", summary: "plan ready" };
    return;
  }

  for (const step of planFromPrompt(opts.prompt)) {
    if (step.kind === "say") {
      yield { type: "assistant_delta", text: step.text + "\n\n" };
      continue;
    }
    const tool: ToolCall = {
      id: randomUUID(),
      name: step.name,
      input: step.input,
      status: "running",
    };
    const approvalRequired = step.needsApproval || needsApproval(step.name, opts.mode);
    if (approvalRequired) {
      const decision = opts.approvals?.[approvalKey(step)];
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
        yield {
          type: "assistant_delta",
          text: "Understood — I skipped that action.\n\n",
        };
        continue;
      }
    }
    yield { type: "tool_start", tool };
    try {
      tool.output = await runTool(step.name, step.input);
      tool.status = "done";
      yield { type: "tool_result", tool };
    } catch (err) {
      tool.status = "error";
      tool.output = err instanceof Error ? err.message : String(err);
      yield { type: "tool_result", tool };
      yield { type: "error", message: tool.output };
      return;
    }
  }
  yield { type: "done", summary: "ok" };
}

export async function* runAgentTurn(opts: {
  prompt: string;
  mode: PermissionMode;
  modelId?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  approvals?: Record<string, "allow" | "deny">;
}): AsyncGenerator<AgentEvent> {
  // Local slash UX that must not hit the LLM
  const lower = opts.prompt.trim().toLowerCase();
  if (
    lower.startsWith("/help") ||
    lower.startsWith("/tree") ||
    lower.startsWith("/init") ||
    lower.startsWith("/clear") ||
    lower.startsWith("/compact") ||
    lower.startsWith("/permissions") ||
    lower.startsWith("/model") ||
    lower.startsWith("/resume") ||
    lower.startsWith("/new")
  ) {
    if (lower.startsWith("/model")) {
      yield {
        type: "assistant_delta",
        text: "Use the model menu in the header to switch Claude / GPT / demo. Helix does not rate-limit you — usage follows your provider key.",
      };
      yield { type: "done", summary: "ok" };
      return;
    }
    yield* runDemoAgentTurn(opts);
    return;
  }

  const model: ModelDef = resolveModelForRuntime(opts.modelId);
  if (opts.modelId && model.id !== opts.modelId) {
    yield {
      type: "assistant_delta",
      text: `No key for \`${opts.modelId}\` in this environment — using \`${model.id}\`.\n\n`,
    };
  }
  if (model.provider === "demo") {
    yield* runDemoAgentTurn(opts);
    return;
  }

  try {
    yield* runLlmAgentTurn({
      prompt: opts.prompt,
      mode: opts.mode,
      model,
      history: opts.history,
      approvals: opts.approvals,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield {
      type: "assistant_delta",
      text: `Model error (${model.id}): ${message}\nFalling back to demo agent for this turn.\n\n`,
    };
    yield* runDemoAgentTurn(opts);
  }
}

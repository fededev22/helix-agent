import { randomUUID } from "crypto";
import { runAgentTurn } from "@/lib/agent";
import {
  approvalKey,
  assertSessionId,
  getSession,
  pendingApprovalsFromSession,
  saveSession,
  type ChatMessage,
  type ToolCall,
} from "@/lib/sessions";

export const runtime = "nodejs";

function sanitizeApprovals(
  pending: ToolCall[],
  requested: Record<string, unknown> | undefined,
): Record<string, "allow" | "deny"> {
  const out: Record<string, "allow" | "deny"> = {};
  if (!requested || typeof requested !== "object") return out;
  const allowedKeys = new Set(pending.map(approvalKey));
  for (const [key, value] of Object.entries(requested)) {
    if (!allowedKeys.has(key)) continue;
    if (value === "allow" || value === "deny") out[key] = value;
  }
  return out;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new Response(JSON.stringify({ error: "Invalid body" }), { status: 400 });
  }

  let sessionId: string;
  try {
    sessionId = assertSessionId(String(body.sessionId ?? ""));
  } catch {
    return new Response(JSON.stringify({ error: "Invalid session id" }), { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), { status: 404 });
  }

  const prompt = String(body.message ?? "").trim().slice(0, 8_000);
  if (!prompt) {
    return new Response(JSON.stringify({ error: "Empty message" }), { status: 400 });
  }

  const resume = Boolean(body.resume);
  const pendingBefore = pendingApprovalsFromSession(session);

  if (resume) {
    if (pendingBefore.length === 0) {
      return new Response(JSON.stringify({ error: "Nothing awaiting approval" }), {
        status: 400,
      });
    }
    const last = session.messages[session.messages.length - 1];
    if (last?.role === "assistant") session.messages.pop();
  } else {
    session.messages.push({
      id: randomUUID(),
      role: "user",
      content: prompt,
      createdAt: new Date().toISOString(),
    });
  }

  const approvals = resume
    ? sanitizeApprovals(pendingBefore, body.approvals as Record<string, unknown>)
    : {};

  if (resume && Object.keys(approvals).length === 0) {
    return new Response(JSON.stringify({ error: "Approval required" }), { status: 400 });
  }

  const history = session.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1)
    .slice(-12)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let assistantText = "";
      const tools: ToolCall[] = [];

      try {
        for await (const event of runAgentTurn({
          prompt,
          mode: session.permissionMode,
          modelId: session.model,
          history,
          approvals,
        })) {
          send(event);
          if (event.type === "assistant_delta") assistantText += event.text;
          if (event.type === "tool_start" || event.type === "tool_awaiting") {
            tools.push(event.tool);
          }
          if (event.type === "tool_result") {
            const idx = tools.findIndex((t) => t.id === event.tool.id);
            if (idx >= 0) tools[idx] = event.tool;
            else tools.push(event.tool);
          }
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      const assistantMsg: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        content: assistantText.trim() || "(no text)",
        toolCalls: tools,
        createdAt: new Date().toISOString(),
      };
      session.messages.push(assistantMsg);
      if (
        (session.title === "New session" || session.title === "Sandbox session") &&
        prompt.length < 60
      ) {
        session.title = prompt.slice(0, 48);
      }
      await saveSession(session);
      send({ type: "session", session });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

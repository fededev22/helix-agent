import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { sandboxRoot } from "./sandbox";

export type PermissionMode = "manual" | "accept_edits" | "plan";

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "pending" | "running" | "awaiting_approval" | "done" | "error" | "denied";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
  createdAt: string;
};

export type Session = {
  id: string;
  title: string;
  permissionMode: PermissionMode;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertSessionId(id: string): string {
  if (typeof id !== "string" || !SESSION_ID_RE.test(id)) {
    throw new Error("Invalid session id");
  }
  return id;
}

function helixDir() {
  return path.join(sandboxRoot(), ".helix");
}

function sessionsDir() {
  return path.resolve(helixDir(), "sessions");
}

function sessionPath(id: string) {
  const safeId = assertSessionId(id);
  const root = sessionsDir();
  const full = path.resolve(root, `${safeId}.json`);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel !== `${safeId}.json`) {
    throw new Error("Invalid session path");
  }
  return full;
}

async function ensureDirs() {
  await fs.mkdir(sessionsDir(), { recursive: true });
}

export async function createSession(
  title = "New session",
  model = "claude-sonnet-4-5",
): Promise<Session> {
  await ensureDirs();
  const now = new Date().toISOString();
  const session: Session = {
    id: randomUUID(),
    title: String(title).slice(0, 80),
    permissionMode: "manual",
    model: String(model).slice(0, 80),
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: randomUUID(),
        role: "system",
        content:
          "Helix is ready. Ask it to explore the sandbox, fix the counter bug, or run /help.",
        createdAt: now,
      },
    ],
  };
  await fs.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2));
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  try {
    const raw = await fs.readFile(sessionPath(id), "utf8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<Omit<Session, "messages">[]> {
  await ensureDirs();
  const dir = sessionsDir();
  const files = await fs.readdir(dir).catch(() => []);
  const sessions = [];
  for (const file of files) {
    if (!/^[0-9a-f-]{36}\.json$/i.test(file)) continue;
    const id = file.slice(0, -5);
    try {
      const raw = await fs.readFile(sessionPath(id), "utf8");
      const s = JSON.parse(raw) as Session;
      const { messages, ...meta } = s;
      void messages;
      sessions.push(meta);
    } catch {
      // skip corrupt / invalid
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveSession(session: Session) {
  await ensureDirs();
  assertSessionId(session.id);
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2));
}

export function pendingApprovalsFromSession(session: Session): ToolCall[] {
  const last = [...session.messages].reverse().find((m) => m.role === "assistant");
  return (last?.toolCalls ?? []).filter((t) => t.status === "awaiting_approval");
}

export function approvalKey(tool: Pick<ToolCall, "name" | "input">) {
  return `${tool.name}:${JSON.stringify(tool.input)}`;
}

export async function readHelixMd() {
  try {
    return await fs.readFile(path.join(sandboxRoot(), "HELIX.md"), "utf8");
  } catch {
    return "";
  }
}

export async function writeHelixMd(content: string) {
  const text = String(content ?? "");
  if (text.length > 50_000) throw new Error("HELIX.md too large");
  await fs.writeFile(path.join(sandboxRoot(), "HELIX.md"), text, "utf8");
}

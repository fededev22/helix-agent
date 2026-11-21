import { NextResponse } from "next/server";
import {
  assertSessionId,
  createSession,
  getSession,
  listSessions,
  saveSession,
  type PermissionMode,
} from "@/lib/sessions";
import { MODELS } from "@/lib/models";

const MODES = new Set<PermissionMode>(["manual", "accept_edits", "plan"]);
const MODEL_IDS = new Set(MODELS.map((m) => m.id));

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id) {
    try {
      assertSessionId(id);
    } catch {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    const session = await getSession(id);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(session);
  }
  return NextResponse.json({ sessions: await listSessions() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "setMode" && body.id && body.mode) {
    try {
      assertSessionId(String(body.id));
    } catch {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    if (!MODES.has(body.mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    const session = await getSession(body.id);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    session.permissionMode = body.mode as PermissionMode;
    await saveSession(session);
    return NextResponse.json(session);
  }
  if (body.action === "setModel" && body.id && body.model) {
    try {
      assertSessionId(String(body.id));
    } catch {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    if (!MODEL_IDS.has(body.model)) {
      return NextResponse.json({ error: "Invalid model" }, { status: 400 });
    }
    const session = await getSession(body.id);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    session.model = body.model;
    await saveSession(session);
    return NextResponse.json(session);
  }
  const session = await createSession(
    String(body.title ?? "New session").slice(0, 80),
    String(body.model ?? "claude-sonnet-4-5"),
  );
  return NextResponse.json(session);
}

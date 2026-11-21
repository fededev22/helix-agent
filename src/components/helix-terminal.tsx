"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessage, PermissionMode, Session, ToolCall } from "@/lib/sessions";
import {
  Check,
  FolderTree,
  Loader2,
  Shield,
  Sparkles,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";

type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  description: string;
  ready: boolean;
};

type LiveTool = ToolCall & { live?: boolean };
type SessionMeta = Omit<Session, "messages">;

const MODES: PermissionMode[] = ["manual", "accept_edits", "plan"];
const SLASH = [
  { cmd: "/help", desc: "List commands" },
  { cmd: "/tree", desc: "Show sandbox files" },
  { cmd: "/permissions", desc: "Cycle permission mode" },
  { cmd: "/init", desc: "Check HELIX.md" },
  { cmd: "/clear", desc: "Clear local transcript view" },
  { cmd: "/compact", desc: "Summarize older turns" },
  { cmd: "/model", desc: "Explain model switching" },
  { cmd: "/resume", desc: "Show session picker" },
  { cmd: "/new", desc: "Start a fresh session" },
];

function modeLabel(mode: PermissionMode) {
  if (mode === "accept_edits") return "accept edits";
  return mode;
}

export function HelixTerminal() {
  const [session, setSession] = useState<Session | null>(null);
  const [tree, setTree] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveTools, setLiveTools] = useState<LiveTool[]>([]);
  const [pending, setPending] = useState<ToolCall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [showResume, setShowResume] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function refreshSessions() {
    const data = await fetch("/api/session").then((r) => r.json());
    setSessionList(data.sessions ?? []);
  }

  async function startNewSession(title = "Sandbox session") {
    const created = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => r.json());
    setSession(created);
    setPending(null);
    setError(null);
    setShowResume(false);
    await refreshSessions();
  }

  async function openSession(id: string) {
    const loaded = await fetch(`/api/session?id=${encodeURIComponent(id)}`).then((r) =>
      r.json(),
    );
    if (loaded.error) throw new Error(loaded.error);
    setSession(loaded);
    const awaiting = [...(loaded.messages as ChatMessage[])]
      .reverse()
      .flatMap((m) => m.toolCalls ?? [])
      .find((t) => t.status === "awaiting_approval");
    setPending(awaiting ?? null);
    setShowResume(false);
    await refreshSessions();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const modelPayload = await fetch("/api/models").then((r) => r.json());
        if (!cancelled) setModels(modelPayload.models ?? []);
        await startNewSession();
        const files = await fetch("/api/files").then((r) => r.json());
        if (!cancelled) setTree(files.tree ?? []);
      } catch (err) {
        if (!cancelled) setBootError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setModel(modelId: string) {
    if (!session) return;
    const updated = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setModel", id: session.id, model: modelId }),
    }).then((r) => r.json());
    if (updated.error) {
      setError(updated.error);
      return;
    }
    setSession(updated);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages, liveText, liveTools, pending]);

  const filteredSlash = useMemo(() => {
    if (!input.startsWith("/")) return [];
    return SLASH.filter((s) => s.cmd.startsWith(input.split(/\s/)[0]));
  }, [input]);

  async function cycleMode() {
    if (!session) return;
    const idx = MODES.indexOf(session.permissionMode);
    const next = MODES[(idx + 1) % MODES.length];
    const updated = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setMode", id: session.id, mode: next }),
    }).then((r) => r.json());
    setSession(updated);
  }

  async function sendMessage(raw: string, extraApprovals?: Record<string, "allow" | "deny">) {
    if (!session || busy) return;
    const text = raw.trim();
    if (!text) return;

    if (text === "/clear") {
      setSession({
        ...session,
        messages: session.messages.filter((m) => m.role === "system").slice(0, 1),
      });
      setInput("");
      return;
    }
    if (text === "/new") {
      setInput("");
      await startNewSession();
      return;
    }
    if (text === "/resume") {
      setInput("");
      await refreshSessions();
      setShowResume(true);
      return;
    }
    if (text === "/permissions") {
      setInput("");
      await cycleMode();
      return;
    }
    if (text === "/compact") {
      setSession({
        ...session,
        messages: [
          session.messages[0],
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "Compacted earlier turns into: explored sandbox, optionally patched demo/app.js, waiting for next instruction.",
            createdAt: new Date().toISOString(),
          },
        ],
      });
      setInput("");
      return;
    }

    setBusy(true);
    setError(null);
    setLiveText("");
    setLiveTools([]);
    setPending(null);
    setInput("");
    setSlashOpen(false);

    const isResume = Boolean(extraApprovals && Object.keys(extraApprovals).length);
    if (!isResume) {
      const optimistic: Session = {
        ...session,
        messages: [
          ...session.messages,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: text,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      setSession(optimistic);
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          message: text,
          resume: Boolean(extraApprovals && Object.keys(extraApprovals).length),
          approvals: extraApprovals ?? {},
        }),
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || "Chat request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let latestSession: Session | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim());
          if (event.type === "assistant_delta") {
            setLiveText((t) => t + event.text);
          } else if (event.type === "tool_start") {
            setLiveTools((tools) => [...tools.filter((t) => t.id !== event.tool.id), event.tool]);
          } else if (event.type === "tool_awaiting") {
            setPending(event.tool);
            setLiveTools((tools) => [...tools.filter((t) => t.id !== event.tool.id), event.tool]);
          } else if (event.type === "tool_result") {
            setLiveTools((tools) =>
              tools.map((t) => (t.id === event.tool.id ? event.tool : t)),
            );
          } else if (event.type === "error") {
            setError(event.message);
          } else if (event.type === "session") {
            latestSession = event.session;
          }
        }
      }

      if (latestSession) {
        startTransition(() => setSession(latestSession));
        const files = await fetch("/api/files").then((r) => r.json());
        setTree(files.tree ?? []);
      }
      setLiveText("");
      setLiveTools([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "allow" | "deny") {
    if (!pending || !session) return;
    const key = `${pending.name}:${JSON.stringify(pending.input)}`;
    const lastUser = [...session.messages].reverse().find((m) => m.role === "user");
    setPending(null);
    if (lastUser) {
      await sendMessage(lastUser.content, { [key]: decision });
    }
  }

  if (bootError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--hx-bg)] p-6 text-[var(--hx-danger)]">
        Failed to start session: {bootError}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--hx-bg)] text-[var(--hx-text-muted)]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-[var(--hx-accent)]" />
        Booting Helix…
      </div>
    );
  }

  return (
    <div className="helix-shell relative min-h-screen overflow-hidden text-[var(--hx-text)]">
      <div className="pointer-events-none absolute inset-0 helix-grid opacity-40" />
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(217,119,58,0.22),transparent_70%)] blur-2xl helix-orb" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(94,177,255,0.16),transparent_70%)] blur-2xl helix-orb-delay" />

      <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-[var(--hx-border)] bg-[var(--hx-surface)]/80 p-4 backdrop-blur lg:border-b-0 lg:border-r">
          <div className="mb-6 flex items-center gap-2">
            <TerminalSquare className="h-5 w-5 text-[var(--hx-accent)]" />
            <div>
              <p className="font-[family-name:var(--hx-font-sans)] text-lg font-semibold tracking-tight">
                Helix
              </p>
              <p className="text-xs text-[var(--hx-text-muted)]">coding agent harness</p>
            </div>
          </div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[var(--hx-text-muted)]">
              <FolderTree className="h-3.5 w-3.5" />
              Sandbox
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-[var(--hx-border)] px-2 text-xs"
              onClick={() => void startNewSession()}
            >
              New
            </Button>
          </div>
          <ScrollArea className="mb-4 h-[28vh] lg:h-[36vh]">
            <ul className="space-y-1 font-[family-name:var(--hx-font-mono)] text-xs">
              {tree.map((f) => (
                <li key={f} className="truncate text-[var(--hx-text-muted)] hover:text-[var(--hx-text)]">
                  {f}
                </li>
              ))}
              {tree.length === 0 && (
                <li className="text-[var(--hx-text-muted)]">Empty workspace</li>
              )}
            </ul>
          </ScrollArea>
          <button
            type="button"
            className="mb-2 flex w-full items-center justify-between text-xs uppercase tracking-[0.14em] text-[var(--hx-text-muted)] hover:text-[var(--hx-text)]"
            onClick={() => {
              void refreshSessions();
              setShowResume((v) => !v);
            }}
          >
            <span>Sessions</span>
            <span>{showResume ? "hide" : "resume"}</span>
          </button>
          {showResume && (
            <ScrollArea className="h-[24vh]">
              <ul className="space-y-1">
                {sessionList.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`w-full truncate rounded px-2 py-1.5 text-left font-[family-name:var(--hx-font-mono)] text-xs hover:bg-[var(--hx-surface-raised)] ${
                        s.id === session.id ? "text-[var(--hx-accent)]" : "text-[var(--hx-text-muted)]"
                      }`}
                      onClick={() => void openSession(s.id)}
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
                {sessionList.length === 0 && (
                  <li className="px-2 text-xs text-[var(--hx-text-muted)]">No saved sessions</li>
                )}
              </ul>
            </ScrollArea>
          )}
        </aside>

        <main className="flex min-h-screen flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hx-border)] bg-[var(--hx-surface)]/70 px-4 py-3 backdrop-blur">
            <div>
              <h1 className="font-[family-name:var(--hx-font-sans)] text-base font-medium">
                {session.title}
              </h1>
              <p className="font-[family-name:var(--hx-font-mono)] text-xs text-[var(--hx-text-muted)]">
                replica/sandbox · {session.model}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 rounded-md border border-[var(--hx-border)] bg-[var(--hx-surface-raised)] px-2 py-1 text-xs text-[var(--hx-text)]">
                <Sparkles className="h-3 w-3 text-[var(--hx-accent)]" />
                <select
                  className="max-w-[180px] bg-transparent outline-none"
                  value={session.model}
                  onChange={(e) => void setModel(e.target.value)}
                  aria-label="Model"
                >
                  {(models.length
                    ? models
                    : [{ id: session.model, label: session.model, ready: true }]
                  ).map((m) => (
                    <option key={m.id} value={m.id} className="bg-[var(--hx-surface)]">
                      {m.label}
                      {"ready" in m && !m.ready ? " (needs key)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Badge
                variant="outline"
                className="cursor-pointer border-[var(--hx-border)] bg-[var(--hx-surface-raised)] text-[var(--hx-text)]"
                onClick={cycleMode}
              >
                <Shield className="mr-1 h-3 w-3 text-[var(--hx-accent)]" />
                {modeLabel(session.permissionMode)}
              </Badge>
              <Badge variant="outline" className="border-[var(--hx-border)] text-[var(--hx-text-muted)]">
                no app rate limits
              </Badge>
            </div>
          </header>

          <ScrollArea className="flex-1 px-4 py-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {session.messages
                .filter((m) => m.role === "system")
                .slice(0, 1)
                .map((m) => (
                  <div
                    key={m.id}
                    className="rounded-[var(--hx-radius-md)] border border-[var(--hx-border)] bg-[var(--hx-surface)]/80 px-4 py-3 text-sm text-[var(--hx-text-muted)] helix-fade"
                  >
                    {m.content}
                  </div>
                ))}

              {session.messages
                .filter((m) => m.role !== "system")
                .map((m) => (
                  <MessageBlock key={m.id} message={m} />
                ))}

              {busy && (liveText || liveTools.length > 0) && (
                <div className="space-y-3">
                  {liveTools.map((t) => (
                    <ToolCard key={t.id} tool={t} />
                  ))}
                  {liveText && (
                    <div className="whitespace-pre-wrap font-[family-name:var(--hx-font-sans)] text-sm leading-relaxed text-[var(--hx-text)]">
                      {liveText}
                      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[var(--hx-accent)] align-middle" />
                    </div>
                  )}
                </div>
              )}

              {pending && (
                <div className="rounded-[var(--hx-radius-md)] border border-[var(--hx-warning)]/40 bg-[var(--hx-surface-raised)] p-4 helix-pop">
                  <p className="mb-1 text-sm font-medium text-[var(--hx-warning)]">
                    Permission needed
                  </p>
                  <p className="mb-3 font-[family-name:var(--hx-font-mono)] text-xs text-[var(--hx-text-muted)]">
                    {pending.name} {JSON.stringify(pending.input).slice(0, 180)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-[var(--hx-accent)] text-[var(--hx-on-accent)] hover:bg-[var(--hx-accent)]/90"
                      onClick={() => decide("allow")}
                    >
                      <Check className="mr-1 h-4 w-4" /> Allow
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide("deny")}>
                      <X className="mr-1 h-4 w-4" /> Deny
                    </Button>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-[var(--hx-radius-md)] border border-[var(--hx-danger)]/40 bg-[var(--hx-surface)] px-4 py-3 text-sm text-[var(--hx-danger)]">
                  {error}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="border-t border-[var(--hx-border)] bg-[var(--hx-surface)]/90 p-4 backdrop-blur">
            <div className="relative mx-auto max-w-3xl">
              {slashOpen && filteredSlash.length > 0 && (
                <div className="absolute bottom-full mb-2 w-full overflow-hidden rounded-[var(--hx-radius-md)] border border-[var(--hx-border)] bg-[var(--hx-surface-raised)] shadow-lg">
                  {filteredSlash.map((s) => (
                    <button
                      key={s.cmd}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--hx-surface)]"
                      onClick={() => {
                        setInput(s.cmd);
                        setSlashOpen(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      <span className="font-[family-name:var(--hx-font-mono)] text-[var(--hx-accent)]">
                        {s.cmd}
                      </span>
                      <span className="text-[var(--hx-text-muted)]">{s.desc}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2 rounded-[var(--hx-radius-md)] border border-[var(--hx-border)] bg-[var(--hx-bg)] p-2 focus-within:border-[var(--hx-accent)]/60">
                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={2}
                  placeholder="Ask Helix to explore, fix, or run a command…  (/ for commands)"
                  className="max-h-40 min-h-[56px] flex-1 resize-none bg-transparent px-2 py-2 font-[family-name:var(--hx-font-mono)] text-sm text-[var(--hx-text)] outline-none placeholder:text-[var(--hx-text-muted)]"
                  onChange={(e) => {
                    setInput(e.target.value);
                    setSlashOpen(e.target.value.startsWith("/"));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && e.shiftKey) {
                      e.preventDefault();
                      cycleMode();
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage(input);
                    }
                    if (e.key === "Escape" && busy) {
                      setBusy(false);
                    }
                  }}
                  disabled={!!pending}
                />
                <Button
                  size="icon"
                  disabled={busy || !!pending || !input.trim()}
                  className="bg-[var(--hx-accent)] text-[var(--hx-on-accent)] hover:bg-[var(--hx-accent)]/90"
                  onClick={() => void sendMessage(input)}
                  aria-label="Send"
                >
                  {busy ? <Square className="h-4 w-4" /> : <span className="text-lg leading-none">↵</span>}
                </Button>
              </div>
              <p className="mt-2 text-xs text-[var(--hx-text-muted)]">
                Claude tool loop when a key is set · demo agent offline · try “fix the counter bug”.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function MessageBlock({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`space-y-3 helix-fade ${isUser ? "ml-4" : ""`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--hx-text-muted)]">
        {isUser ? "you" : "helix"}
      </div>
      {message.toolCalls?.map((t) => (
        <ToolCard key={t.id} tool={t} />
      ))}
      <div
        className={`whitespace-pre-wrap text-sm leading-relaxed ${
          isUser ? "text-[var(--hx-user)]" : "text-[var(--hx-text)]"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolCall }) {
  const running = tool.status === "running" || tool.status === "pending";
  return (
    <div className="overflow-hidden rounded-[var(--hx-radius-sm)] border border-[var(--hx-border)] bg-[var(--hx-bg)]/80">
      <div className="flex items-center gap-2 border-b border-[var(--hx-border)] px-3 py-1.5 font-[family-name:var(--hx-font-mono)] text-xs text-[var(--hx-tool)]">
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        <span>{tool.name}</span>
        <span className="text-[var(--hx-text-muted)]">{tool.status}</span>
      </div>
      <pre className="max-h-48 overflow-auto px-3 py-2 font-[family-name:var(--hx-font-mono)] text-[11px] leading-relaxed text-[var(--hx-text-muted)]">
        {JSON.stringify(tool.input, null, 2)}
        {tool.output ? `\n---\n${tool.output}` : ""}
      </pre>
    </div>
  );
}

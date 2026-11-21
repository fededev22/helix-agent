import fs from "fs/promises";
import path from "path";

export function sandboxRoot() {
  return path.join(process.cwd(), "replica", "sandbox");
}

export function resolveSafe(relativePath: string) {
  const root = path.resolve(sandboxRoot());
  const cleaned = relativePath.replace(/^\/+/, "") || ".";
  if (cleaned.includes("\0")) throw new Error("Invalid path");
  const resolved = path.resolve(root, cleaned);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes the sandbox");
  }
  return resolved;
}

export async function listTree(rel = ".", depth = 3): Promise<string[]> {
  const root = resolveSafe(rel);
  const out: string[] = [];

  async function walk(dir: string, prefix: string, level: number) {
    if (level > depth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".helix" || entry.name.startsWith(".")) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(entry.isDirectory() ? `${relPath}/` : relPath);
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath, level + 1);
      }
    }
  }

  await walk(root, rel === "." ? "" : rel, 0);
  return out;
}

export async function readFileSafe(rel: string) {
  const full = resolveSafe(rel);
  const stat = await fs.stat(full);
  if (!stat.isFile()) throw new Error("Not a file");
  if (stat.size > 200_000) throw new Error("File too large for this demo");
  return fs.readFile(full, "utf8");
}

export async function writeFileSafe(rel: string, content: string) {
  const full = resolveSafe(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

export async function grepSafe(pattern: string, rel = ".") {
  if (pattern.length > 200) throw new Error("Pattern too long");
  const root = resolveSafe(rel);
  const results: string[] = [];
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    throw new Error("Invalid search pattern");
  }

  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".helix" || entry.name.startsWith(".")) continue;
      const next = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(next, relPath);
      } else {
        const text = await fs.readFile(next, "utf8").catch(() => "");
        text.split(/\r?\n/).forEach((line, i) => {
          if (re.test(line)) results.push(`${relPath}:${i + 1}: ${line}`);
        });
      }
    }
  }

  await walk(root, rel === "." ? "" : rel);
  return results.slice(0, 80).join("\n") || "(no matches)";
}

export async function globSafe(pattern: string) {
  if (pattern.length > 200) throw new Error("Pattern too long");
  const files = await listTree(".", 8);
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return files.filter((f) => re.test(f.replace(/\/$/, ""))).join("\n") || "(no matches)";
}

/** Pure-JS stand-ins for a few safe read-only commands. No child_process. */
export async function bashSafe(command: string) {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("Empty command");
  if (/[;&|`$<>\\]/.test(trimmed) || trimmed.includes("\n")) {
    throw new Error("Shell metacharacters are blocked");
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const bin = parts[0];
  const args = parts.slice(1);

  switch (bin) {
    case "pwd": {
      if (args.length) throw new Error("pwd takes no arguments");
      return ".";
    }
    case "ls": {
      const target = args.find((a) => !a.startsWith("-")) ?? ".";
      if (args.some((a) => a.startsWith("-") && !/^-[1la]+$/.test(a))) {
        throw new Error("Only simple ls flags are allowed");
      }
      const entries = await listTree(target, 1);
      return entries.join("\n") || "(empty)";
    }
    case "cat": {
      if (args.length !== 1 || args[0].startsWith("-")) {
        throw new Error("Usage: cat <path>");
      }
      return await readFileSafe(args[0]);
    }
    case "head": {
      let lines = 10;
      let file: string | undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-n" && args[i + 1]) {
          lines = Math.min(200, Math.max(1, Number(args[++i])));
          if (!Number.isFinite(lines)) throw new Error("Invalid -n");
        } else if (!args[i].startsWith("-")) {
          file = args[i];
        } else {
          throw new Error("Unsupported head flag");
        }
      }
      if (!file) throw new Error("Usage: head [-n N] <path>");
      const text = await readFileSafe(file);
      return text.split(/\r?\n/).slice(0, lines).join("\n");
    }
    case "wc": {
      const file = args.find((a) => !a.startsWith("-"));
      if (!file) throw new Error("Usage: wc <path>");
      if (args.some((a) => a.startsWith("-") && !/^-[lwc]+$/.test(a))) {
        throw new Error("Only -l/-w/-c flags are allowed");
      }
      const text = await readFileSafe(file);
      const lineCount = text.length ? text.split(/\r?\n/).length : 0;
      const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      const byteCount = Buffer.byteLength(text, "utf8");
      return `${lineCount} ${wordCount} ${byteCount} ${file}`;
    }
    default:
      throw new Error(
        `Command not allowed: ${bin}. Allowed: ls, pwd, cat, head, wc (no shell, no node/npm)`,
      );
  }
}

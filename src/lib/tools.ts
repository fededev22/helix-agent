import {
  bashSafe,
  globSafe,
  grepSafe,
  listTree,
  readFileSafe,
  writeFileSafe,
} from "./sandbox";
import type { PermissionMode } from "./sessions";

export const TOOL_DEFS = [
  {
    name: "list_files",
    description: "List files and folders in the sandbox workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Relative path, default ." },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the sandbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Relative file path" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file in the sandbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "grep",
    description: "Search file contents with a regex pattern.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "glob",
    description: "Find files by glob pattern (e.g. **/*.ts).",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "bash",
    description:
      "Run a safe read-only command: ls, pwd, cat, head, or wc. No shell, no node/npm.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    },
  },
];

export function needsApproval(name: string, mode: PermissionMode) {
  if (mode === "plan") return name === "write_file" || name === "bash";
  if (mode === "accept_edits") return name === "bash";
  return name === "write_file" || name === "bash";
}

export async function runTool(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "list_files":
      return (await listTree(String(input.path ?? "."))).join("\n");
    case "read_file":
      return await readFileSafe(String(input.path));
    case "write_file":
      await writeFileSafe(String(input.path), String(input.content ?? ""));
      return `Wrote ${input.path}`;
    case "grep":
      return await grepSafe(String(input.pattern), String(input.path ?? "."));
    case "glob":
      return await globSafe(String(input.pattern ?? "**/*"));
    case "bash":
      return await bashSafe(String(input.command));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function openaiTools() {
  return TOOL_DEFS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: t.input_schema.properties,
        required: t.input_schema.required,
      },
    },
  }));
}

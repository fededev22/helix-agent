import { NextResponse } from "next/server";
import { readHelixMd, writeHelixMd } from "@/lib/sessions";

export async function GET() {
  return NextResponse.json({ content: await readHelixMd() });
}

export async function POST(req: Request) {
  const body = await req.json();
  const content =
    body.content ??
    `# Helix project instructions

Prefer clear TypeScript, accessible UI, and short regression notes after fixes.
`;
  await writeHelixMd(content);
  return NextResponse.json({ ok: true, content });
}

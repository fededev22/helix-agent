import { NextResponse } from "next/server";
import { listTree, readFileSafe } from "@/lib/sandbox";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  if (path) {
    try {
      const content = await readFileSafe(path);
      return NextResponse.json({ path, content });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
  }
  return NextResponse.json({ tree: await listTree(".") });
}

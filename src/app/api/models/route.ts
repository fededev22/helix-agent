import { NextResponse } from "next/server";
import { MODELS, providerReady } from "@/lib/models";

export async function GET() {
  return NextResponse.json({
    models: MODELS.map((m) => ({
      ...m,
      ready: providerReady(m.provider),
    })),
    note: "No app-side rate limits. Usage is billed only by the provider key you attach.",
  });
}

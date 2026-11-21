import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serverClient } from "@/lib/supabase/server";
import { connection } from "@/lib/supabase/config";
import { fallbackInsight, insightFacts, selectInsights } from "@/lib/insights";
import type { Dashboard } from "@/lib/full-types";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
    });
  try {
    const auth = request.headers.get("authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const origin = request.headers.get("origin");
    if (!bearer && origin && origin !== request.nextUrl.origin)
      return reply({ error: "Request origin not allowed." }, 403);
    if (Number(request.headers.get("content-length") || 0) > 2048)
      return reply({ error: "Request too large." }, 413);
    const raw = await request.text();
    if (raw.length > 2048) return reply({ error: "Request too large." }, 413);
    let payload: { type?: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return reply({ error: "Invalid request." }, 400);
    }
    if (!payload || !["walk", "run", "ride"].includes(payload.type || ""))
      return reply({ error: "Choose walk, run, or ride." }, 400);
    let db;
    if (bearer) {
      const { url, key } = connection();
      db = createClient(url, key, {
        global: { headers: { Authorization: "Bearer " + bearer } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } else db = await serverClient();
    const {
      data: { user },
      error,
    } = await db.auth.getUser(bearer || undefined);
    if (error || !user) return reply({ error: "Sign in again." }, 401);
    const budget = await db.rpc("pc_reserve_insight");
    if (budget.error)
      return reply(
        {
          error:
            "Progress summaries are unavailable. Check the database migration.",
        },
        503,
      );
    if (!budget.data)
      return reply(
        {
          error:
            "You can request five summaries per hour. Your charts are still available.",
        },
        429,
      );
    const result = await db.rpc("pc_dashboard", { p_type: payload.type });
    if (result.error || !result.data)
      return reply({ error: "Your verified progress could not load." }, 503);
    const facts = insightFacts(result.data as Dashboard, payload.type!);
    let text = fallbackInsight(facts),
      mode = "calculated";
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          signal: AbortSignal.timeout(12000),
          headers: {
            Authorization: "Bearer " + process.env.OPENAI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL,
            store: false,
            max_output_tokens: 600,
            instructions:
              "Select one to three useful, non-repeating progress highlight IDs from these checked facts. Do not make medical, safety, cheating, or reward decisions. Return the required schema.",
            input: JSON.stringify(facts),
            text: {
              format: {
                type: "json_schema",
                name: "progress_highlights",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["highlights"],
                  properties: {
                    highlights: {
                      type: "array",
                      items: { type: "string", enum: Object.keys(facts) },
                      minItems: 1,
                      maxItems: 3,
                    },
                  },
                },
              },
            },
          }),
        });
        if (response.ok) {
          const body = await response.json();
          const output = (body.output || [])
            .flatMap(
              (o: { content?: { type: string; text?: string }[] }) =>
                o.content || [],
            )
            .filter((o: { type: string }) => o.type === "output_text")
            .map((o: { text: string }) => o.text)
            .join("");
          const validated = selectInsights(JSON.parse(output), facts);
          if (validated) {
            text = validated;
            mode = "ai";
          }
        } else
          console.warn(
            JSON.stringify({
              event: "insights_provider_unavailable",
              status: response.status,
              requestId,
            }),
          );
      } catch {
        console.warn(JSON.stringify({ event: "insights_fallback", requestId }));
      }
    }
    return reply({ text, mode });
  } catch {
    console.error(
      JSON.stringify({ event: "insights_request_failed", requestId }),
    );
    return reply(
      { error: "The summary could not load. Please try again." },
      503,
    );
  }
}

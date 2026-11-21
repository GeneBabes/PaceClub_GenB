import { NextRequest, NextResponse } from "next/server";
import { loadAccount } from "@/lib/account";
import { STORAGE_KEY, transition, type Action } from "@/lib/onboarding";

export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  let sameHost = false;
  try {
    sameHost = !!origin && new URL(origin).host === request.headers.get("host");
  } catch {
    /* Reject malformed origins. */
  }
  if (
    !sameHost ||
    request.headers.get("sec-fetch-site") === "cross-site" ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return reply({ error: "Please submit this form from PaceClub." }, 403);
  try {
    const text = await request.text();
    if (text.length > 16_000)
      return reply({ error: "That request is too large." }, 413);
    const body = JSON.parse(text) as { revision?: unknown; action?: Action };
    if (
      !Number.isSafeInteger(body.revision) ||
      !body.action ||
      typeof body.action !== "object"
    )
      return reply({ error: "Please choose an answer and try again." }, 400);
    const account = await loadAccount();
    if (!account.user)
      return reply(
        {
          error: "Your session has ended. Sign in again to continue.",
          signIn: true,
        },
        401,
      );
    if (!account.profile?.is_active)
      return reply({ error: "This account cannot continue onboarding." }, 403);
    if (account.error || !account.onboarding)
      return reply(
        { error: account.error || "Your saved progress is unavailable." },
        503,
      );
    if (account.complete) return reply({ destination: "/home" });
    if (body.revision !== account.progress.revision)
      return reply(
        {
          error:
            "Your progress changed in another tab or device. Reload to continue with the latest answers.",
          reload: true,
        },
        409,
      );
    let next;
    try {
      next = transition(account.progress, body.action);
    } catch (error) {
      return reply(
        {
          error:
            error instanceof Error
              ? error.message
              : "Please check your answer.",
        },
        400,
      );
    }
    const previous = account.onboarding.answers;
    // Preserve unrelated onboarding data and reject stale-tab writes atomically.
    const answers = { ...previous, [STORAGE_KEY]: next.progress };
    const { data, error } = await account.supabase
      .from("onboarding_answers")
      .update({
        answers,
        ...(next.complete
          ? { tutorial_completed_at: new Date().toISOString() }
          : {}),
      })
      .eq("user_id", account.user.id)
      .eq("answers", JSON.stringify(previous))
      .select("answers, tutorial_completed_at")
      .maybeSingle();
    if (error)
      return reply(
        {
          error:
            "We could not save this step. Your earlier progress is safe. Please try again.",
        },
        503,
      );
    if (!data)
      return reply(
        {
          error:
            "Your progress changed in another tab or device. Reload before continuing.",
          reload: true,
        },
        409,
      );
    if (next.clanId) {
      const result = await account.supabase
        .from("profiles")
        .update({ clan_id: next.clanId })
        .eq("id", account.user.id)
        .select("clan_id")
        .single();
      // On partial failure readProgress returns to the result screen until both rows agree.
      if (result.error)
        return reply(
          {
            error:
              "Your answers are saved, but your clan could not be confirmed. Reload and confirm your clan again.",
            reload: true,
          },
          503,
        );
    }
    return reply(
      next.complete ? { destination: "/home" } : { progress: next.progress },
    );
  } catch {
    return reply(
      {
        error:
          "We could not process that step. Please check your connection and try again.",
      },
      400,
    );
  }
}

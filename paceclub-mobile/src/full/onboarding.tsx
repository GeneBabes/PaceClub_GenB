import { Text, View } from "react-native";
import { router } from "expo-router";
import { useAccountData } from "./Context";
import { checked, db, useAction } from "./data";
import {
  CLANS,
  GOALS,
  QUESTIONS,
  TOUR,
  readProgress,
  recommendations,
  transition,
  STORAGE_KEY,
  type Action,
} from "./onboarding-rules";
import { Button, Card, Feedback, Frame, H, P, ui } from "./ui";
export function Onboarding() {
  const q = useAccountData(),
    a = useAction();
  if (!q.data)
    return (
      <Frame title="Your first steps">
        <Feedback state={q} />
      </Frame>
    );
  const { profile, onboarding } = q.data,
    p = readProgress(onboarding.answers, profile.clan_id);
  const send = (action: Action) =>
    void a.run(async () => {
      const result = transition(p, action);
      if (result.clanId)
        checked(
          await db
            .from("profiles")
            .update({ clan_id: result.clanId })
            .eq("id", profile.id)
            .select("id")
            .single(),
        );
      checked(
        await db
          .from("onboarding_answers")
          .update({
            answers: { ...onboarding.answers, [STORAGE_KEY]: result.progress },
            ...(result.complete
              ? { tutorial_completed_at: new Date().toISOString() }
              : {}),
          })
          .eq("user_id", profile.id)
          .select("user_id")
          .single(),
      );
      q.reload();
      if (result.complete)
        router.replace({
          pathname: "/hub/[section]",
          params: { section: "home" },
        });
    }, "Progress saved.");
  return (
    <Frame
      title="Make it yours."
      subtitle="A few preferences help you choose a clan. They do not measure ability or change scoring."
    >
      <Feedback state={a} />
      <Card>
        {p.step === "goal" ? (
          <>
            <H>What brings you here?</H>
            {GOALS.map((g) => (
              <Button
                key={g.id}
                secondary
                disabled={a.busy}
                onPress={() => send({ type: "goal", goal: g.id })}
              >
                {g.title}
              </Button>
            ))}
          </>
        ) : p.step === "quiz" ? (
          <>
            <Text style={ui.eyebrow}>
              QUESTION {p.questionIndex + 1} OF {QUESTIONS.length}
            </Text>
            <H>{QUESTIONS[p.questionIndex].title}</H>
            {QUESTIONS[p.questionIndex].options.map((o) => (
              <Button
                key={o.clan}
                secondary
                disabled={a.busy}
                onPress={() =>
                  send({
                    type: "answer",
                    questionId: QUESTIONS[p.questionIndex].id,
                    clanId: o.clan,
                  })
                }
              >
                {o.text}
              </Button>
            ))}
            <Button
              secondary
              disabled={a.busy}
              onPress={() => send({ type: "back" })}
            >
              Back
            </Button>
          </>
        ) : p.step === "result" ? (
          <>
            <H>Your clan, your choice.</H>
            <P>
              Suggested:{" "}
              {recommendations(p.responses)
                .winners.map((id) => CLANS.find((c) => c.id === id)?.name)
                .join(" or ")}
              . Choose any clan you feel comfortable with.
            </P>
            {CLANS.map((c) => (
              <View key={c.id} style={{ gap: 8 }}>
                <P>{c.description}</P>
                <Button
                  disabled={a.busy}
                  onPress={() => send({ type: "confirm", clanId: c.id })}
                >
                  Choose {c.name}
                </Button>
              </View>
            ))}
            <Button
              secondary
              disabled={a.busy}
              onPress={() => send({ type: "review" })}
            >
              Review answers
            </Button>
          </>
        ) : (
          <>
            <H>{TOUR[p.tutorialIndex].title}</H>
            <P>{TOUR[p.tutorialIndex].text}</P>
            <P note>
              {p.tutorialIndex === 2
                ? "Record your first activity from Home. Pending activities remain private until verified."
                : TOUR[p.tutorialIndex].note}
            </P>
            {p.tutorialIndex > 0 && (
              <Button
                secondary
                disabled={a.busy}
                onPress={() => send({ type: "back" })}
              >
                Back
              </Button>
            )}
            <Button
              disabled={a.busy}
              onPress={() =>
                send({
                  type: p.tutorialIndex === TOUR.length - 1 ? "finish" : "next",
                })
              }
            >
              {p.tutorialIndex === TOUR.length - 1 ? "Let’s begin" : "Next"}
            </Button>
          </>
        )}
      </Card>
    </Frame>
  );
}

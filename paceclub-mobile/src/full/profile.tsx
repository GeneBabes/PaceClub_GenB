import { useState } from "react";
import { router } from "expo-router";
import { useAccountData } from "./Context";
import { useRecorder } from "../providers/RecorderProvider";
import { checked, db, useAction } from "./data";
import { Button, Card, Feedback, Field, Frame, H, P, Photo } from "./ui";
import { CLANS } from "./onboarding-rules";
import { pickPhoto, uploadPhoto } from "./photos";
import { disablePush } from "./push";
export function Profile() {
  const account = useAccountData(),
    p = account.data!.profile,
    [draftName, setName] = useState<string | null>(null),
    a = useAction(),
    recorder = useRecorder();
  const name = draftName ?? p.display_name;
  return (
    <Frame title="Make it yours.">
      <Feedback state={a} />
      <Card>
        <Photo
          path={p.avatar_path}
          bucket="avatars"
          avatar
          gold={account.data?.items.some((i) => i.type === "avatar_frame")}
        />
        <H>{p.display_name}</H>
        <P>{CLANS.find((c) => c.id === p.clan_id)?.name}</P>
        {account.data?.items
          .filter((i) => i.type === "badge")
          .map((i) => (
            <P key={i.id} note>
              ✦ {i.name}
            </P>
          ))}
        <Field
          label="Display name"
          value={name}
          onChange={setName}
          maxLength={80}
        />
        <Button
          disabled={a.busy}
          onPress={() =>
            void a.run(async () => {
              checked(
                await db
                  .from("profiles")
                  .update({ display_name: name.trim() })
                  .eq("id", p.id)
                  .select("id")
                  .single(),
              );
              account.reload();
            })
          }
        >
          Save name
        </Button>
        <Button
          secondary
          disabled={a.busy}
          onPress={() =>
            void a.run(async () => {
              const photo = await pickPhoto();
              if (!photo) return;
              const path = await uploadPhoto(photo, p.id, "avatars");
              try {
                checked(
                  await db
                    .from("profiles")
                    .update({ avatar_path: path })
                    .eq("id", p.id)
                    .select("id")
                    .single(),
                );
              } catch (e) {
                await db.storage.from("avatars").remove([path]);
                throw e;
              }
              account.reload();
            }, "Picture saved.")
          }
        >
          Change profile picture
        </Button>
      </Card>
      <Button
        secondary
        disabled={a.busy}
        onPress={() =>
          void a.run(async () => {
            await recorder.pause("Paused when you signed out.");
            await disablePush(p.id);
            const signedOut = await db.auth.signOut();
            if (signedOut.error) throw signedOut.error;
            router.replace("/");
          }, "Signed out.")
        }
      >
        Sign out
      </Button>
      <P>
        Your saved routes stay on this phone, associated with your account. A
        network connection is needed to unregister push notifications before
        signing out.
      </P>
    </Frame>
  );
}

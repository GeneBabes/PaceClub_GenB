import { useEffect } from "react";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../providers/AuthProvider";
import { useAccountData } from "../../full/Context";
import { isComplete } from "../../full/onboarding-rules";
import { Button, Feedback, Frame, P } from "../../full/ui";
import {
  Home,
  Analytics,
  Rewards,
  Notifications,
  History,
} from "../../full/overview";
import { Play, Clubs } from "../../full/play";
import { Community, Chat } from "../../full/social";
import { Profile } from "../../full/profile";
import { Territory } from "../../full/territory";
import { Moderation } from "../../full/moderation";
import { Safety } from "../../full/safety";
import { watchPush } from "../../full/push";
const screens: Record<string, React.ComponentType> = {
  home: Home,
  play: Play,
  clubs: Clubs,
  community: Community,
  chat: Chat,
  analytics: Analytics,
  rewards: Rewards,
  notifications: Notifications,
  profile: Profile,
  territory: Territory,
  moderation: Moderation,
  safety: Safety,
  history: History,
};
export default function Hub() {
  const { section } = useLocalSearchParams<{ section: string }>(),
    auth = useAuth(),
    account = useAccountData(),
    userId = auth.session?.user.id;
  useEffect(() => {
    if (!userId) return;
    return watchPush(userId, () =>
      router.push({
        pathname: "/hub/[section]",
        params: { section: "notifications" },
      }),
    );
  }, [userId]);
  if (auth.ready && !auth.session) return <Redirect href="/" />;
  if (!account.data)
    return (
      <Frame title="Welcome back.">
        <Feedback state={account} />
        {!!account.error && (
          <>
            <P>
              Check the database migrations and your connection, then retry.
            </P>
            <Button onPress={account.reload}>Retry</Button><Button secondary onPress={()=>router.push('/account')}>Account & sign out</Button>
          </>
        )}
      </Frame>
    );
  if (!account.data.profile.is_active)
    return (
      <Frame title="Account inactive.">
        <P>Contact your project administrator.</P><Button secondary onPress={()=>router.push('/account')}>Account & sign out</Button>
      </Frame>
    );
  if (!isComplete(account.data.onboarding, account.data.profile.clan_id))
    return <Redirect href="/onboarding" />;
  const Page = screens[section] || Home;
  return <Page key={section + auth.session!.user.id} />;
}

import { createContext, useContext, type ReactNode } from "react";
import { useData, checked, db, rpc } from "./data";
import { useAuth } from "../providers/AuthProvider";
import type { Item } from "./types";
import type { Profile, OnboardingRow } from "./onboarding-rules";
const Context = createContext<ReturnType<typeof useAccount> | null>(null);
function useAccount() {
  const { session } = useAuth();
  return useData(
    "account",
    async () => {
      const id = session!.user.id;
      const profile = checked(
        await db
          .from("profiles")
          .select("id,display_name,avatar_path,clan_id,is_active")
          .eq("id", id)
          .single(),
      ) as Profile;
      const onboarding = checked(
        await db
          .from("onboarding_answers")
          .select("answers,tutorial_completed_at")
          .eq("user_id", id)
          .single(),
      ) as OnboardingRow;
      const role = await rpc<string>("pc_my_role");
      const owned =
        checked(
          await db
            .from("user_inventory")
            .select("item_id")
            .eq("user_id", id)
            .eq("equipped", true),
        ) || [];
      const items = owned.length
        ? (checked(
            await db
              .from("reward_items")
              .select("*")
              .in(
                "id",
                owned.map((x) => x.item_id),
              ),
          ) as Item[])
        : [];
      return { profile, onboarding, role, items };
    },
    ["profiles", "onboarding_answers", "user_inventory"],
  );
}
export function FullProvider({ children }: { children: ReactNode }) {
  const value = useAccount();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAccountData() {
  const value = useContext(Context);
  if (!value) throw new Error("Account provider missing");
  return value;
}

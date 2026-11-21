import { redirect } from "next/navigation";
import { loadAccount } from "@/lib/account";
import FullApp, { type Section } from "./full-app";
export default async function FullPage({ section }: { section: Section }) {
  const a = await loadAccount();
  if (!a.user || !a.profile?.is_active) redirect("/");
  if (a.error || !a.complete) redirect("/onboarding");
  const { data } = await a.supabase.rpc("pc_my_role");
  return (
    <FullApp
      section={section}
      user={{
        id: a.user.id,
        name: a.profile.display_name,
        clan: a.profile.clan_id,
      }}
      role={typeof data === "string" ? data : "athlete"}
    />
  );
}

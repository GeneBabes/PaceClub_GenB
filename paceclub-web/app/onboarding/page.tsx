import { redirect } from "next/navigation";
import { loadAccount } from "@/lib/account";
import OnboardingWizard from "./wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Find your clan · PaceClub" };
export default async function OnboardingPage() {
  const account = await loadAccount();
  if (!account.user || !account.profile?.is_active) redirect("/");
  if (account.error || !account.onboarding)
    return (
      <main>
        <p className="eyebrow">PACECLUB / FIRST STEPS</p>
        <h1>Let’s reconnect.</h1>
        <p role="alert">{account.error || "Your progress is unavailable."}</p>
        <a className="button-link" href="/onboarding">
          Try again
        </a>
        <a className="text-link" href="/">
          Back to your account
        </a>
      </main>
    );
  if (account.complete) redirect("/home");
  return (
    <OnboardingWizard
      initialProgress={account.progress}
      displayName={account.profile.display_name}
    />
  );
}

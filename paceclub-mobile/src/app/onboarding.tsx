import { Redirect } from "expo-router";
import { useAuth } from "../providers/AuthProvider";
import { Onboarding } from "../full/onboarding";
export default function OnboardingRoute() {
  const { session, ready } = useAuth();
  if (ready && !session) return <Redirect href="/" />;
  return <Onboarding />;
}

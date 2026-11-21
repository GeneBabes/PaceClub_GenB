import { Redirect } from "expo-router";
import AccountScreen from "../../App";
import { useAuth } from "../providers/AuthProvider";
export default function Index() {
  const { session, ready } = useAuth();
  if (ready && session) return <Redirect href="/hub/home" />;
  return <AccountScreen />;
}

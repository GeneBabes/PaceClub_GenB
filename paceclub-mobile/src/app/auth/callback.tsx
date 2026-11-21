import { Redirect } from "expo-router";
// openAuthSessionAsync in lib/oauth.ts owns the PKCE exchange. Never exchange a code twice.
export default function Callback() {
  return <Redirect href="/" />;
}

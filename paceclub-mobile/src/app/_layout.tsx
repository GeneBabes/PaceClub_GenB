import { Stack } from "expo-router";
import { FullProvider } from "../full/Context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../providers/AuthProvider";
import { RecorderProvider } from "../providers/RecorderProvider";

export default function Layout() {
  return (
    <AuthProvider>
      <RecorderProvider>
        <FullProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: "#f3f1e9" },
              headerTintColor: "#193b32",
              headerShadowVisible: false,
              contentStyle: { backgroundColor: "#f3f1e9" },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="record"
              options={{ title: "Record activity" }}
            />
            <Stack.Screen
              name="activities"
              options={{ title: "Saved on this phone" }}
            />
            <Stack.Screen
              name="activity/[id]"
              options={{ title: "Activity review" }}
            />
            <Stack.Screen
              name="hub/[section]"
              options={{ title: "PaceClub" }}
            />
            <Stack.Screen
              name="onboarding"
              options={{ title: "Your first steps" }}
            />
            <Stack.Screen
              name="auth/callback"
              options={{ title: "Signing in" }}
            />
          </Stack>
        </FullProvider>
      </RecorderProvider>
    </AuthProvider>
  );
}

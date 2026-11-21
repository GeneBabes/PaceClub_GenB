import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Image,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
  Pressable,
  type KeyboardTypeOptions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Button, ui } from "../components/ActivityUI";
import { useAccountData } from "./Context";
import { checked, db } from "./data";
export { Button, ui };
export const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: "#c5d2c9",
    borderRadius: 10,
    padding: 13,
    backgroundColor: "#fff",
    color: "#193b32",
    minHeight: 48,
  },
  nav: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#e2ebdf",
  },
  divider: {
    borderTopWidth: 1,
    borderColor: "#e2e7df",
    paddingTop: 12,
    gap: 10,
  },
});
export function P({
  children,
  note = false,
}: {
  children: ReactNode;
  note?: boolean;
}) {
  return <Text style={note ? ui.note : ui.text}>{children}</Text>;
}
export function H({ children }: { children: ReactNode }) {
  return <Text style={ui.heading}>{children}</Text>;
}
export function Card({ children }: { children: ReactNode }) {
  return <View style={ui.card}>{children}</View>;
}
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  keyboardType,
  maxLength = 2000,
}: {
  label: string;
  value: string;
  onChange: (x: string) => void;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
}) {
  return (
    <View style={{ gap: 6 }}>
      <P>{label}</P>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType}
        maxLength={maxLength}
        style={[
          styles.input,
          multiline && { minHeight: 90, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}
export function Choices({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (x: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <P>{label}</P>
      <View style={ui.row}>
        {options.map((o) => (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.id === value }}
            onPress={() => onChange(o.id)}
            style={[
              styles.nav,
              o.id === value && { backgroundColor: "#245741" },
            ]}
          >
            <Text
              style={{
                color: o.id === value ? "white" : "#245741",
                fontWeight: "600",
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function Feedback({
  state,
}: {
  state: { error?: string; message?: string; loading?: boolean };
}) {
  const text =
    state.error || state.message || (state.loading ? "Loading…" : "");
  return text ? (
    <Text
      accessibilityLiveRegion="polite"
      style={[ui.note, state.error ? ui.error : null]}
    >
      {text}
    </Text>
  ) : null;
}
export function LinkButton({
  section,
  label,
}: {
  section: string;
  label: string;
}) {
  return (
    <Button
      secondary
      onPress={() =>
        router.push({ pathname: "/hub/[section]", params: { section } })
      }
    >
      {label}
    </Button>
  );
}
export const sections = [
  ["home", "Home"],
  ["play", "Play"],
  ["clubs", "Clubs"],
  ["community", "Community"],
  ["chat", "Chat"],
  ["history", "History"],
  ["analytics", "Analytics"],
  ["territory", "Territory"],
  ["rewards", "Rewards"],
  ["notifications", "Inbox"],
  ["safety", "Check-ins"],
  ["profile", "Profile"],
] as const;
export function Frame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const account = useAccountData();
  const sunrise = account.data?.items.some((i) => i.name === "Sunrise theme");
  return (
    <SafeAreaView
      edges={["bottom", "left", "right"]}
      style={[ui.screen, sunrise && { backgroundColor: "#fff0dc" }]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={ui.content}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {sections.map(([id, name]) => (
            <Pressable
              key={id}
              style={styles.nav}
              onPress={() =>
                router.replace({
                  pathname: "/hub/[section]",
                  params: { section: id },
                })
              }
              accessibilityRole="button"
            >
              <Text style={{ color: "#245741" }}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={ui.eyebrow}>PACECLUB / YOUR PACE</Text>
        <Text style={ui.title}>{title}</Text>
        {subtitle && <P>{subtitle}</P>}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Confirm(label: string, body: string, work: () => void) {
  Alert.alert(label, body, [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", onPress: work },
  ]);
}
export function Photo({
  path,
  bucket = "activity-photos",
  avatar = false,
  gold = false,
}: {
  path: string | null;
  bucket?: string;
  avatar?: boolean;
  gold?: boolean;
}) {
  const [signed, setSigned] = useState<{ key: string; url: string } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    async function refresh() {
      if (!path) return;
      try {
        const data = checked(
          await db.storage.from(bucket).createSignedUrl(path, 300),
        );
        if (live && data)
          setSigned({ key: bucket + path, url: data.signedUrl });
      } catch {
        if (live) setSigned(null);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 240000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path, bucket]);
  return signed?.key === bucket + path ? (
    <Image
      accessibilityLabel={avatar ? "Profile picture" : "Shared activity photo"}
      source={{ uri: signed.url }}
      style={
        avatar
          ? {
              width: 80,
              height: 80,
              borderRadius: 40,
              borderWidth: gold ? 4 : 0,
              borderColor: "#d3a547",
            }
          : { height: 210, width: "100%", borderRadius: 12 }
      }
    />
  ) : null;
}

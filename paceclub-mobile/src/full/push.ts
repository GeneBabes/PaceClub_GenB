import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { rpc } from "./data";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
const key = (id: string) => "paceclub:push:" + id;
export async function enablePush(userId: string) {
  if (Platform.OS === "web")
    throw Error(
      "Use the installed Android or iOS app for phone notifications.",
    );
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "PaceClub updates",
      importance: AndroidImportance.DEFAULT,
    });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw Error(
      "Notifications are disabled. You can enable them in phone settings.",
    );
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.easConfig?.projectId;
  if (!projectId)
    throw Error(
      "Link this app to its EAS project and rebuild before enabling push.",
    );
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await rpc("pc_register_push", { p_token: token });
  await AsyncStorage.setItem(key(userId), token);
}
export async function disablePush(userId: string) {
  const token = await AsyncStorage.getItem(key(userId));
  if (token) await rpc("pc_unregister_push", { p_token: token });
  await AsyncStorage.removeItem(key(userId));
  await Notifications.dismissAllNotificationsAsync();
}
export function watchPush(userId: string, onOpen: () => void) {
  let live = true;
  const response = Notifications.addNotificationResponseReceivedListener(() => {
    if (live) onOpen();
  });
  const token = Notifications.addPushTokenListener(() => {
    void AsyncStorage.getItem(key(userId))
      .then((saved) => {
        if (saved && live) return enablePush(userId);
      })
      .catch(() => {});
  });
  return () => {
    live = false;
    response.remove();
    token.remove();
  };
}

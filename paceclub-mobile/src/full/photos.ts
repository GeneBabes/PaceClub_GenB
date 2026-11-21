import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { checked, db } from "./data";
export type PickedPhoto = { uri: string; mime: string; extension: string };
export async function pickPhoto(camera = false): Promise<PickedPhoto | null> {
  if (camera) {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted)
      throw Error("Allow camera access to take an activity photo.");
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: true,
    quality: 0.65,
  };
  const r = camera
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (r.canceled) return null;
  const asset = r.assets[0],
    file = new File(asset.uri),
    mime = asset.mimeType || file.type;
  const extension = (
    { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<
      string,
      string
    >
  )[mime];
  if (!extension) throw Error("Choose a JPG, PNG, or WebP photo.");
  return { uri: asset.uri, mime, extension };
}
export async function uploadPhoto(
  photo: PickedPhoto,
  folder: string,
  bucket = "activity-photos",
) {
  const file = new File(photo.uri);
  if (file.size > (bucket === "avatars" ? 2 : 5) * 1024 * 1024)
    throw Error(
      "Choose a smaller photo (under " +
        (bucket === "avatars" ? "2" : "5") +
        " MiB).",
    );
  const path = folder + "/" + randomUUID() + "." + photo.extension;
  checked(
    await db.storage
      .from(bucket)
      .upload(path, await file.arrayBuffer(), {
        contentType: photo.mime,
        upsert: false,
      }),
  );
  return path;
}

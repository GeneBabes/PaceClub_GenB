import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const target = fileURLToPath(
    new URL("../paceclub-mobile/app.json", import.meta.url),
  ),
  source = process.argv[2];
if (!source || path.resolve(source) === target)
  throw Error("Pass the path to app.json in your OLD working project.");
const old = JSON.parse(fs.readFileSync(source, "utf8")),
  template = JSON.parse(fs.readFileSync(target, "utf8"));
if (!old.expo || !old.expo.android?.package)
  throw Error(
    "The old app.json must contain its Expo Android package name. For app.config.ts/js, merge the listed plugins manually.",
  );
const key = (p) => (Array.isArray(p) ? p[0] : p);
const plugins = new Map((old.expo.plugins || []).map((p) => [key(p), p]));
for (const required of template.expo.plugins || []) {
  const name = key(required),
    current = plugins.get(name);
  if (!current) {
    plugins.set(name, required);
    continue;
  }
  if (name === "expo-image-picker") {
    const options = Array.isArray(current) ? current[1] : {};
    plugins.set(name, [
      name,
      {
        ...options,
        cameraPermission: "Take a photo to share with your PaceClub activity.",
        microphonePermission: false,
      },
    ]);
  }
}
const output = {
  ...template,
  expo: { ...template.expo, ...old.expo, plugins: [...plugins.values()] },
};
fs.copyFileSync(target, target + ".before-merge");
fs.writeFileSync(target, JSON.stringify(output, null, 2) + "\n");
console.log(
  "Preserved your app identity and existing config. Added required plugins and enabled activity photos. Rebuild the native app.",
);

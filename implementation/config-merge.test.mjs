import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("upgrade helper preserves the installed app identity and adds required native plugins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paceclub-config-"));
  try {
    fs.mkdirSync(path.join(dir, "tools"));
    fs.mkdirSync(path.join(dir, "paceclub-mobile"));
    const tool = path.join(dir, "tools", "merge-mobile-config.mjs");
    const target = path.join(dir, "paceclub-mobile", "app.json");
    const source = path.join(dir, "old-app.json");
    fs.copyFileSync(
      new URL("../tools/merge-mobile-config.mjs", import.meta.url),
      tool,
    );
    fs.copyFileSync(
      new URL("../paceclub-mobile/app.json", import.meta.url),
      target,
    );
    const template = fs.readFileSync(target, "utf8");
    const old = {
      expo: {
        name: "My PaceClub",
        scheme: "my-paceclub",
        owner: "my-team",
        icon: "./assets/custom-icon.png",
        android: { package: "org.example.existing", versionCode: 7 },
        ios: { bundleIdentifier: "org.example.existing.ios" },
        extra: { eas: { projectId: "existing-project-id" }, custom: "keep" },
        plugins: [
          ["expo-web-browser", { experimentalLauncherActivity: true }],
          [
            "expo-image-picker",
            { cameraPermission: false, photosPermission: "My existing text" },
          ],
        ],
      },
    };
    fs.writeFileSync(source, JSON.stringify(old));
    const run = spawnSync(process.execPath, [tool, source], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(fs.readFileSync(target, "utf8")).expo;
    for (const key of [
      "name",
      "scheme",
      "owner",
      "icon",
      "android",
      "ios",
      "extra",
    ])
      assert.deepEqual(result[key], old.expo[key]);
    const plugins = new Map(
      result.plugins.map((p) => [Array.isArray(p) ? p[0] : p, p]),
    );
    for (const name of [
      "expo-notifications",
      "expo-sensors",
      "expo-location",
      "expo-sqlite",
      "expo-router",
    ])
      assert.ok(plugins.has(name));
    assert.deepEqual(plugins.get("expo-web-browser"), old.expo.plugins[0]);
    assert.equal(
      plugins.get("expo-image-picker")[1].photosPermission,
      "My existing text",
    );
    assert.equal(
      typeof plugins.get("expo-image-picker")[1].cameraPermission,
      "string",
    );
    assert.equal(fs.readFileSync(target + ".before-merge", "utf8"), template);
    assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")), old);
    assert.notEqual(spawnSync(process.execPath, [tool, target]).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

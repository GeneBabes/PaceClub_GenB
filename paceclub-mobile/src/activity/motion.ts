import { useEffect, useRef } from "react";
import { Accelerometer, Gyroscope } from "expo-sensors";
import type { LocalActivity, MotionSummary } from "./model";
export function useMotion(activity: LocalActivity | null) {
  const seed = useRef(activity);
  useEffect(() => {
    seed.current = activity;
  }, [activity]);
  const current = useRef<MotionSummary | null>(null);
  const id = activity?.id,
    enabled = activity?.phase === "recording";
  useEffect(() => {
    let live = true;
    const subscriptions: { remove: () => void }[] = [];
    let gyro = 0,
      gyroAt = 0;
    current.current = seed.current?.motion
      ? { ...seed.current.motion }
      : {
          accelerometer: "unavailable",
          gyroscope: "unavailable",
          accelerationSamples: 0,
          rotationSamples: 0,
          peakG: 0,
          peakRotation: 0,
          alertAt: 0,
        };
    async function start() {
      for (const [sensor, kind] of [
        [Accelerometer, "accelerometer"],
        [Gyroscope, "gyroscope"],
      ] as const) {
        try {
          if (!(await sensor.isAvailableAsync())) continue;
          if (!live) return;
          const permission = await sensor.requestPermissionsAsync();
          if (!live || permission.status !== "granted") continue;
          current.current![kind] = "available";
          sensor.setUpdateInterval(250);
          const sub = sensor.addListener((value) => {
            if (!live || !current.current) return;
            const magnitude = Math.hypot(value.x, value.y, value.z);
            if (!Number.isFinite(magnitude)) return;
            const m = current.current;
            if (kind === "accelerometer") {
              m.accelerationSamples++;
              m.peakG = Math.max(m.peakG, magnitude);
              if (
                magnitude > 3.5 &&
                gyro > 3 &&
                Date.now() - gyroAt < 1000 &&
                Date.now() - m.alertAt > 30000
              )
                m.alertAt = Date.now();
            } else {
              m.rotationSamples++;
              m.peakRotation = Math.max(m.peakRotation, magnitude);
              gyro = magnitude;
              gyroAt = Date.now();
            }
          });
          if (live) subscriptions.push(sub);
          else sub.remove();
        } catch {
          /* Unavailable sensors never prevent GPS recording. */
        }
      }
    }
    if (enabled) void start();
    return () => {
      live = false;
      subscriptions.forEach((s) => s.remove());
    };
  }, [id, enabled]);
  return current;
}

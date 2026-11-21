"use client";
import { useRef, useState } from "react";
import {
  importActivity,
  parseGPX,
  practicePoints,
  type ImportedPoint,
} from "@/lib/import-activity";
import { db, Feedback, useAction } from "./data";
import { PageTitle } from "./overview";
export function ImportPractice({
  practice,
  userId,
}: {
  practice: boolean;
  userId: string;
}) {
  const a = useAction(),
    [points, setPoints] = useState<ImportedPoint[] | null>(null),
    [xml, setXml] = useState(""),
    [result, setResult] = useState(""),
    [type, setType] = useState("walk");
  const retry = useRef<{ key: string; id: string } | null>(null);
  return (
    <>
      <PageTitle
        eyebrow={practice ? "LEARN THE FLOW" : "BRING YOUR JOURNEY"}
        title={
          practice
            ? "Practice, without the competition."
            : "Your routes, in one place."
        }
        text={
          practice
            ? "A labeled desk simulation lets you test submission, validation, and history without pretending you went outdoors."
            : "Import a timestamped GPX track into your private activity history."
        }
      />
      <section className="card">
        <p className="soft-note">
          {practice
            ? "All samples are synthetic."
            : "GPX files are imported records, not recordings made by this app."}{" "}
          These activities do not earn XP, tokens, ranked progress, competitive
          unlocks, or territory.{" "}
          {practice
            ? "They are also excluded from physical-activity charts."
            : "Valid imports can appear in your personal analytics and may be shared with an explicit GPX label."}
        </p>
        <label>
          Activity type
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              retry.current = null;
            }}
          >
            <option value="walk">Walk</option>
            <option value="run">Run</option>
            <option value="ride">Ride</option>
          </select>
        </label>
        {practice ? (
          <button
            className="secondary"
            onClick={() => {
              setPoints(practicePoints());
              retry.current = null;
              setResult("");
            }}
          >
            Generate a 2-minute practice session
          </button>
        ) : (
          <label>
            GPX file
            <input
              type="file"
              accept=".gpx,application/gpx+xml"
              onChange={(e) => {
                const file = e.target.files?.[0];
                setPoints(null);
                setResult("");
                retry.current = null;
                if (file)
                  void a.run(async () => {
                    if (file.size > 10 * 1024 * 1024)
                      throw Error("Choose a file under 10 MiB.");
                    const text = await file.text();
                    setPoints(parseGPX(text));
                    setXml(text);
                  }, "Track ready to review.");
              }}
            />
          </label>
        )}
        {points && (
          <>
            <p>
              {points.length.toLocaleString()} points ·{" "}
              {new Date(points[0].timestamp).toLocaleString()} –{" "}
              {new Date(points.at(-1)!.timestamp).toLocaleString()}
            </p>
            {practice && (
              <p className="muted">
                GPS: synthetic route · Accelerometer: synthetic demonstration
                marker · Gyroscope: synthetic demonstration marker. Real sensor
                measurements are collected only by the mobile recorder.
              </p>
            )}
            <button
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  const key = `${userId}:${type}:${practice}:${points[0].timestamp}`;
                  if (retry.current?.key !== key)
                    retry.current = { key, id: crypto.randomUUID() };
                  const id = await importActivity(
                    db(),
                    retry.current.id,
                    type,
                    practice ? "simulation" : "gpx",
                    points,
                    practice ? undefined : xml,
                  );
                  setResult(id);
                }, "Saved to your private history.")
              }
            >
              {a.busy
                ? "Uploading…"
                : "Submit " + (practice ? "labeled practice" : "GPX activity")}
            </button>
          </>
        )}
        <Feedback state={a} />
        {result && (
          <p>
            <a className="primary-link" href={`/activities/${result}`}>
              View activity and decision →
            </a>
          </p>
        )}
      </section>
    </>
  );
}

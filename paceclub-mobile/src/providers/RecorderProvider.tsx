import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import { randomUUID } from "expo-crypto";
import { useKeepAwake } from "expo-keep-awake";
import { supabase } from "../../lib/supabase";
import {
  addFix,
  createActivity,
  finishActivity,
  MAX_SESSION_MS,
  pauseActivity,
  recoverActivity,
  recoverCheckIns,
  resumeActivity,
  submissionProblem,
  type ActivityType,
  type LocalActivity,
  type Point,
  type RecordingOptions,
  type SafetyEvent,
} from "../activity/model";
import { useMotion } from "../activity/motion";
import { localStore } from "../activity/store";
import { uploadActivity } from "../activity/sync";
import { useAuth } from "./AuthProvider";

function Awake() {
  useKeepAwake("paceclub-recording");
  return null;
}
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
type Recorder = {
  activity: LocalActivity | null;
  activities: LocalActivity[];
  points: Point[];
  ready: boolean;
  busy: boolean;
  syncing: boolean;
  message: string;
  signal: string;
  fatal: boolean;
  saveSafety: (event: SafetyEvent) => Promise<void>;
  start: (type: ActivityType, options?: RecordingOptions) => Promise<void>;
  pause: (reason?: string) => Promise<void>;
  resume: () => Promise<void>;
  finish: () => Promise<string | undefined>;
  discard: (id: string) => Promise<void>;
  submit: (id: string) => Promise<void>;
  retry: () => Promise<void>;
  reload: () => void;
};
const RecorderContext = createContext<Recorder | null>(null);
export function RecorderProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const owner = useRef<string | null>(null);
  const current = useRef<LocalActivity | null>(null);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const generation = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const actionLock = useRef(false),
    syncLock = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const retryTimes = useRef(
    new Map<string, { failures: number; at: number }>(),
  );
  const [activity, setActivity] = useState<LocalActivity | null>(null);
  const motion = useMotion(activity);
  const [activities, setActivities] = useState<LocalActivity[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(false);
  const [fatal, setFatal] = useState(false),
    [message, setMessage] = useState(""),
    [signal, setSignal] = useState("GPS starts when you tap Start");
  const [reloadIndex, setReloadIndex] = useState(0);
  const run = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(work);
    queue.current = result.catch(() => {});
    return result;
  }, []);
  const stop = useCallback(() => {
    generation.current++;
    watcher.current?.remove();
    watcher.current = null;
  }, []);
  const publish = useCallback((a: LocalActivity) => {
    current.current = a.phase === "finished" ? null : a;
    if (owner.current !== a.userId) return;
    setActivity(current.current);
    setActivities((prev) =>
      [a, ...prev.filter((item) => item.id !== a.id)].sort(
        (a, b) => b.startedAt - a.startedAt,
      ),
    );
  }, []);
  const storageFailure = useCallback(
    (error: unknown) => {
      stop();
      if (current.current) {
        current.current = recoverActivity(current.current);
        setActivity(current.current);
      }
      setFatal(true);
      setMessage(
        `Recording stopped because the phone could not save data. ${errorText(error)} Reload your saved activity before continuing.`,
      );
    },
    [stop],
  );
  const pause = useCallback(
    async (reason = "Paused by you.") => {
      const at = Date.now();
      stop();
      await run(async () => {
        const a = current.current;
        if (!a || a.phase !== "recording") return;
        const next = pauseActivity(
          {
            ...a,
            ...(motion.current ? { motion: { ...motion.current } } : {}),
          },
          at,
          reason,
        );
        await localStore.save(next);
        publish(next);
      }).catch(storageFailure);
    },
    [publish, run, stop, storageFailure, motion],
  );
  const refreshList = useCallback(async (id: string) => {
    const list = await localStore.list(id);
    if (owner.current === id) setActivities(list);
  }, []);
  useEffect(() => {
    owner.current = userId;
    stop();
    void run(async () => {
      setReady(false);
      setActivities([]);
      setActivity(null);
      setPoints([]);
      setMessage("");
      setFatal(false);
      if (current.current)
        await localStore.save(recoverActivity(current.current));
      current.current = null;
      if (!userId) {
        setReady(true);
        return;
      }
      const stored = await localStore.list(userId);
      const list = stored.map(recoverCheckIns);
      for (let i = 0; i < list.length; i++) {
        if (list[i] !== stored[i]) await localStore.save(list[i]);
      }
      const live = list.find((a) => a.phase !== "finished");
      if (owner.current !== userId) return;
      if (live) {
        const recovered = recoverActivity(live);
        await localStore.save(recovered);
        const savedPoints = await localStore.points(userId, live.id);
        if (owner.current !== userId) return;
        publish(recovered);
        setPoints(savedPoints);
      }
      await refreshList(userId);
      setReady(true);
    }).catch(storageFailure);
    return stop;
  }, [userId, reloadIndex, stop, run, publish, refreshList, storageFailure]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      if (state !== "active")
        void pause("PaceClub left the foreground. Tap Resume to continue.");
    });
    return () => listener.remove();
  }, [pause]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!foreground.current) return;
      void run(async () => {
        const a = current.current;
        if (!a || a.phase !== "recording" || a.userId !== owner.current) return;
        const now = Date.now();
        if (now < a.updatedAt || now - a.startedAt >= MAX_SESSION_MS) {
          stop();
          const next = pauseActivity(
            a,
            a.updatedAt,
            "Recording limit or clock change detected. Finish this activity.",
          );
          await localStore.save(next);
          publish(next);
          return;
        }
        const next = {
          ...a,
          updatedAt: now,
          ...(motion.current ? { motion: { ...motion.current } } : {}),
        };
        await localStore.save(next);
        publish(next);
      }).catch(storageFailure);
    }, 5000);
    return () => clearInterval(timer);
  }, [run, publish, stop, storageFailure, motion]);
  const watch = useCallback(
    async (id: string) => {
      const token = ++generation.current;
      setSignal("Waiting for an accurate GPS fix");
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 3,
        },
        (location) => {
          if (
            generation.current !== token ||
            owner.current !== id ||
            !foreground.current
          )
            return;
          const receivedAt = Date.now();
          void run(async () => {
            if (
              generation.current !== token ||
              owner.current !== id ||
              !foreground.current
            )
              return;
            const a = current.current;
            if (!a || a.phase !== "recording") return;
            const result = addFix(
              a,
              {
                timestamp: location.timestamp,
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                accuracy: location.coords.accuracy,
                mocked: location.mocked,
              },
              receivedAt,
            );
            setSignal(result.signal);
            if (result.activity !== a) {
              await localStore.save(result.activity, result.point);
              publish(result.activity);
            }
            if (result.point) setPoints((prev) => [...prev, result.point!]);
          }).catch(storageFailure);
        },
        (reason) => {
          if (generation.current !== token) return;
          setMessage(`GPS stopped: ${reason}`);
          void pause("GPS stopped. Check Location settings, then tap Resume.");
        },
      );
      if (
        token !== generation.current ||
        owner.current !== id ||
        !foreground.current
      )
        sub.remove();
      else watcher.current = sub;
    },
    [run, publish, pause, storageFailure],
  );
  const withAction = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      if (actionLock.current) return;
      actionLock.current = true;
      setBusy(true);
      setMessage("");
      try {
        return await work();
      } catch (e) {
        setMessage(errorText(e));
      } finally {
        actionLock.current = false;
        setBusy(false);
      }
    },
    [],
  );
  const begin = useCallback(
    async (type?: ActivityType, options: RecordingOptions = {}) => {
      await withAction(async () => {
        const id = owner.current;
        if (!id || !ready || fatal)
          throw new Error("Sign in and load your saved activities first.");
        if (!(await Location.hasServicesEnabledAsync()))
          throw new Error(
            "Turn on Location services on your phone, then try again.",
          );
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted")
          throw new Error(
            "Location permission is needed to record a route. Enable it in your phone settings.",
          );
        if (!foreground.current || owner.current !== id)
          throw new Error("Return to PaceClub and try again.");
        await run(async () => {
          if (!foreground.current || owner.current !== id)
            throw new Error("Return to PaceClub and try again.");
          const a = current.current;
          if (type && a)
            throw new Error("Finish or discard your current activity first.");
          if (!type && !a) throw new Error("There is no activity to resume.");
          const next = type
            ? {
                ...createActivity(randomUUID(), id, type, Date.now()),
                ...options,
              }
            : resumeActivity(a!, Date.now());
          try {
            await localStore.save(next);
          } catch (e) {
            storageFailure(e);
            throw e;
          }
          publish(next);
          if (type) setPoints([]);
        });
        try {
          await watch(id);
        } catch (e) {
          await pause("GPS could not start. Tap Resume to retry.");
          throw e;
        }
      });
    },
    [withAction, ready, fatal, run, publish, watch, pause, storageFailure],
  );
  const finish = useCallback(
    async () =>
      withAction(async () => {
        stop();
        const at = Date.now();
        return run(async () => {
          const a = current.current;
          if (!a || a.userId !== owner.current) return;
          const next = finishActivity(
            {
              ...a,
              ...(motion.current ? { motion: { ...motion.current } } : {}),
            },
            at,
          );
          try {
            await localStore.save(next);
          } catch (e) {
            storageFailure(e);
            throw e;
          }
          publish(next);
          return next.id;
        });
      }),
    [withAction, stop, run, publish, storageFailure, motion],
  );
  const discard = useCallback(
    async (id: string) => {
      await withAction(async () => {
        if (current.current?.id === id) stop();
        await run(async () => {
          const user = owner.current;
          if (!user) return;
          await localStore.discard(user, id);
          if (current.current?.id === id) {
            current.current = null;
            setActivity(null);
            setPoints([]);
          }
          await refreshList(user);
        });
      });
    },
    [withAction, stop, run, refreshList],
  );
  const syncNow = useCallback(
    async (force = false) => {
      const id = owner.current;
      if (!id || syncLock.current || !foreground.current) return;
      syncLock.current = true;
      setSyncing(true);
      try {
        const list = await localStore.list(id);
        for (const a of list.filter((a) => a.sync === "queued")) {
          if (owner.current !== id || !foreground.current) break;
          const retry = retryTimes.current.get(a.id);
          if (!force && retry && retry.at > Date.now()) continue;
          try {
            await uploadActivity(
              supabase,
              a,
              await localStore.points(id, a.id),
            );
            await localStore.markUploaded(
              id,
              a.id,
              JSON.stringify(a.safetyEvents || []),
            );
            retryTimes.current.delete(a.id);
          } catch (e) {
            const failures = (retry?.failures ?? 0) + 1;
            retryTimes.current.set(a.id, {
              failures,
              at:
                Date.now() +
                Math.min(300_000, 15_000 * 2 ** Math.min(failures, 5)),
            });
            await localStore.syncState(id, a.id, "queued", errorText(e));
          }
        }
        await refreshList(id);
      } catch (e) {
        if (owner.current === id) setMessage(`Upload paused: ${errorText(e)}`);
      } finally {
        syncLock.current = false;
        setSyncing(false);
      }
    },
    [refreshList],
  );
  useEffect(() => {
    if (!ready || !userId) return;
    void syncNow();
    const timer = setInterval(() => void syncNow(), 15_000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncNow();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [ready, userId, syncNow]);
  const submit = useCallback(
    async (id: string) => {
      await withAction(async () => {
        const user = owner.current;
        if (!user) throw new Error("Sign in first.");
        const a = (await localStore.list(user)).find((a) => a.id === id);
        if (!a) throw new Error("Saved activity not found.");
        const problem = submissionProblem(a);
        if (problem) throw new Error(problem);
        if (a.sync === "synced") return;
        await localStore.syncState(user, id, "queued");
        await refreshList(user);
        void syncNow(true);
      });
    },
    [withAction, refreshList, syncNow],
  );
  const saveSafety = useCallback(
    async (event: SafetyEvent) => {
      await run(async () => {
        const user = owner.current;
        if (!user) return;
        const a =
          current.current?.id === event.activityId
            ? current.current
            : (await localStore.list(user)).find(
                (x) => x.id === event.activityId,
              );
        if (!a || a.userId !== user) return;
        const events = [
          ...(a.safetyEvents || []).filter((e) => e.id !== event.id),
          event,
        ];
        if (events.length > 100) throw Error("Check-in event limit reached.");
        const next: LocalActivity = {
          ...a,
          safetyEvents: events,
          sync: a.sync === "synced" ? "queued" : a.sync,
        };
        await localStore.save(next);
        if (current.current?.id === a.id) publish(next);
        else await refreshList(user);
      });
    },
    [run, publish, refreshList],
  );
  const own = activity?.userId === userId ? activity : null;
  return (
    <RecorderContext.Provider
      value={{
        activity: own,
        activities: activities.filter((a) => a.userId === userId),
        points: own ? points : [],
        ready,
        busy,
        syncing,
        message,
        signal,
        fatal,
        saveSafety,
        start: (type, options) => begin(type, options),
        resume: () => begin(),
        pause,
        finish,
        discard,
        submit,
        retry: () => syncNow(true),
        reload: () => setReloadIndex((n) => n + 1),
      }}
    >
      {own?.phase === "recording" && !fatal && <Awake />}
      {children}
    </RecorderContext.Provider>
  );
}
export function useRecorder() {
  const value = useContext(RecorderContext);
  if (!value) throw new Error("RecorderProvider is missing.");
  return value;
}

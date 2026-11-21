"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
export const db = () => browserClient();
export function checked<T>(result: {
  data: T;
  error: { message: string } | null;
}): T {
  if (result.error) throw Error(result.error.message);
  return result.data;
}
export async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  return checked(await db().rpc(name, args)) as T;
}
export function useData<T>(
  key: string,
  loader: () => Promise<T>,
  tables: string[] = [],
) {
  const ref = useRef(loader);
  ref.current = loader;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string;
    busy: boolean;
  }>({ key, data: null, error: "", busy: true });
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const names = tables.join(",");
  useEffect(() => {
    let alive = true;
    setState((s) => ({
      key,
      data: s.key === key ? s.data : null,
      error: "",
      busy: true,
    }));
    void ref
      .current()
      .then((data) => {
        if (alive) setState({ key, data, error: "", busy: false });
      })
      .catch((e) => {
        if (alive)
          setState({
            key,
            data: null,
            error:
              e instanceof Error ? e.message : "Could not load. Please retry.",
            busy: false,
          });
      });
    return () => {
      alive = false;
    };
  }, [key, version]);
  useEffect(() => {
    if (!names) return;
    let timer: ReturnType<typeof setTimeout>;
    let channel = db().channel("pc-" + key + "-" + Math.random());
    for (const table of names.split(","))
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          clearTimeout(timer);
          timer = setTimeout(reload, 250);
        },
      );
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      void db().removeChannel(channel);
    };
  }, [key, names, reload]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : "",
    busy: state.key !== key || state.busy,
    reload,
  };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  return {
    busy,
    message,
    run: async (work: () => Promise<unknown>, success = "Saved.") => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setMessage("");
      try {
        await work();
        setMessage(success);
      } catch (e) {
        setMessage(
          e instanceof Error ? e.message : "Could not save. Please retry.",
        );
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
  };
}
export function Feedback({
  state,
}: {
  state: {
    busy: boolean;
    error?: string;
    message?: string;
    reload?: () => void;
  };
}) {
  return (
    <>
      {state.busy && (
        <p className="muted" aria-live="polite">
          Loading…
        </p>
      )}
      {(state.error || state.message) && (
        <p className="soft-note" role="status">
          {state.error || state.message}{" "}
          {state.error && state.reload && (
            <button onClick={state.reload}>Retry</button>
          )}
        </p>
      )}
    </>
  );
}
export function Photo({
  path,
  bucket = "activity-photos",
  alt,
}: {
  path: string | null;
  bucket?: string;
  alt: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    setUrl("");
    if (!path) return;
    const load = async () => {
      const { data } = await db()
        .storage.from(bucket)
        .createSignedUrl(path, 300);
      if (live) setUrl(data?.signedUrl || "");
    };
    void load();
    const timer = setInterval(() => void load(), 240000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path, bucket]);
  return url ? (
    <img
      className={bucket === "avatars" ? "avatar-mini" : "post-photo"}
      src={url}
      alt={alt}
    />
  ) : null;
}
export const date = (value: string) =>
  new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
export const km = (m: number | null | undefined) =>
  (Number(m || 0) / 1000).toFixed(2);
export const minutes = (s: number | null | undefined) =>
  Math.round(Number(s || 0) / 60);

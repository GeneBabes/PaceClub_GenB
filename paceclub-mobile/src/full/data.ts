import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../providers/AuthProvider";
export { supabase as db };
export function checked<T>(r: {
  data: T;
  error: { message: string } | null;
}): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
) {
  return checked(await supabase.rpc(name, args)) as T;
}
export const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Could not complete the request. Please try again.";
export function useData<T>(
  key: string,
  loader: () => Promise<T>,
  tables: string[] = [],
) {
  const { session } = useAuth();
  const owner = session?.user.id || "",
    identity = owner + ":" + key;
  const ref = useRef(loader);
  useEffect(() => {
    ref.current = loader;
  }, [loader]);
  const [version, setVersion] = useState(0),
    [state, setState] = useState<{
      key: string;
      data?: T;
      error: string;
      loading: boolean;
    }>({ key: "", error: "", loading: true });
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const pathname = usePathname();
  const tableKey = tables.join(",");
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(async () => {
        if (!live) return;
        setState((prev) => ({
          key: identity,
          data: prev.key === identity ? prev.data : undefined,
          error: "",
          loading: true,
        }));
        if (!owner) {
          setState({ key: identity, error: "", loading: false });
          return;
        }
        const data = await ref.current();
        if (live) setState({ key: identity, data, error: "", loading: false });
      })
      .catch((e) => {
        if (live)
          setState({ key: identity, error: errorText(e), loading: false });
      });
    return () => {
      live = false;
    };
  }, [identity, owner, version, pathname]);
  useEffect(() => {
    if (!owner || !tableKey) return;
    let timer: ReturnType<typeof setTimeout>;
    const channel = supabase.channel(
      "mobile:" + identity + ":" + Math.random(),
    );
    for (const table of tableKey.split(","))
      channel.on(
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
      void supabase.removeChannel(channel);
    };
  }, [identity, owner, tableKey, reload]);
  return {
    data: state.key === identity ? state.data : undefined,
    error: state.key === identity ? state.error : "",
    loading: state.key !== identity || state.loading,
    reload,
  };
}
export function useAction() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
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
        setMessage(errorText(e));
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
  };
}
export const km = (n: number | null | undefined) =>
  ((Number(n) || 0) / 1000).toFixed(2) + " km";
export const date = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

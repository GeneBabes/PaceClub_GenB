import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

const AuthContext = createContext<{
  session: Session | null;
  ready: boolean;
  error: string;
}>({ session: null, ready: false, error: "" });
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      authEvent = false;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      authEvent = true;
      if (live) {
        setSession(next);
        setReady(true);
      }
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (live) {
        if (!authEvent) setSession(data.session);
        setReady(true);
        if (error) setError(error.message);
      }
    });
    const refresh = (state: string) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    };
    refresh(AppState.currentState ?? "active");
    const listener = AppState.addEventListener("change", refresh);
    return () => {
      live = false;
      data.subscription.unsubscribe();
      listener.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);
  return (
    <AuthContext.Provider value={{ session, ready, error }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}

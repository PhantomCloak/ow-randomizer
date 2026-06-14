import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export type Role = "tank" | "dps" | "support";

export interface Player {
  name: string;
  role: Role;
  hero: string;
  rerolled: boolean;
}

export type Team = Player[];

export type SharedState = {
  activePlayers: string[];
  teams: [Team, Team] | null;
  uniqueHeroes: boolean;
  avoidPreviousRoles: boolean;
  previousRoles: Array<[string, Role]>;
  selectedMaps: string[];
  pickedMap: string | null;
};

export function isSharedState(v: unknown): v is SharedState {
  return (
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as SharedState).activePlayers) &&
    Array.isArray((v as SharedState).selectedMaps)
  );
}

export type RegisteredUser = { name: string; createdAt: string };

export async function loginOrRegister(
  name: string,
  password: string,
): Promise<"registered" | "ok"> {
  if (!supabase) throw new Error("auth unavailable");
  const { data, error } = await supabase.rpc("login_or_register", {
    p_name: name,
    p_password: password,
  });
  if (error) throw error;
  return data === "registered" ? "registered" : "ok";
}

export async function listUsers(adminPassword: string): Promise<RegisteredUser[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_users", {
    p_password: adminPassword,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.map((row) => ({
    name: String(row.name),
    createdAt: String(row.created_at),
  }));
}

export async function userReroll(
  name: string,
  password: string,
  newHero: string,
): Promise<void> {
  if (!supabase) throw new Error("auth unavailable");
  const { error } = await supabase.rpc("user_reroll", {
    p_name: name,
    p_password: password,
    p_new_hero: newHero,
  });
  if (error) throw error;
}

type Options = {
  applyRemote: (s: SharedState) => void;
  canPush: boolean;
  password: string | null;
  pollMs?: number;
};

export function useSharedSync({
  applyRemote,
  canPush,
  password,
  pollMs = 3000,
}: Options) {
  const knownVersionRef = useRef(-1);
  const applyRemoteRef = useRef(applyRemote);
  applyRemoteRef.current = applyRemote;

  // ready=true when the initial fetch has completed (or when Supabase isn't
  // configured at all). Admin pushes are gated on this so the very first
  // local mutation doesn't overwrite remote state before we've read it.
  const [ready, setReady] = useState(supabase === null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const { data, error } = await client
          .from("shared_state")
          .select("version, state")
          .eq("id", 1)
          .single();
        if (cancelled) return;
        if (error) throw error;
        setOnline(true);
        if (data && typeof data.version === "number" && data.version > knownVersionRef.current) {
          knownVersionRef.current = data.version;
          if (isSharedState(data.state)) {
            applyRemoteRef.current(data.state);
          }
        }
        if (!cancelled) setReady(true);
      } catch (e) {
        if (cancelled) return;
        setOnline(false);
        setReady(true);
        console.warn("[sync] poll failed", e);
      }
    };

    const start = () => {
      if (intervalId !== null) return;
      void tick();
      intervalId = setInterval(tick, pollMs);
    };
    const stop = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollMs]);

  const push = useCallback(
    async (s: SharedState) => {
      const client = supabase;
      if (!client || !canPush || !password) return;
      try {
        const { data, error } = await client.rpc("update_shared_state", {
          p_password: password,
          p_state: s,
        });
        if (error) throw error;
        setOnline(true);
        const row = Array.isArray(data) ? data[0] : data;
        if (row && typeof row.version === "number") {
          knownVersionRef.current = row.version;
        }
      } catch (e) {
        setOnline(false);
        console.warn("[sync] push failed", e);
      }
    },
    [canPush, password],
  );

  return { push, online, ready };
}

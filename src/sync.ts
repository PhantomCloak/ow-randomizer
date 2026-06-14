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
  playersA: string[];
  playersB: string[];
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
    Array.isArray((v as SharedState).playersA) &&
    Array.isArray((v as SharedState).playersB) &&
    Array.isArray((v as SharedState).selectedMaps)
  );
}

type Options = {
  applyRemote: (s: SharedState) => void;
  isAdmin: boolean;
  password: string | null;
  pollMs?: number;
};

export function useSharedSync({
  applyRemote,
  isAdmin,
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

    void tick();
    const id = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  const push = useCallback(
    async (s: SharedState) => {
      const client = supabase;
      if (!client || !isAdmin || !password) return;
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
    [isAdmin, password],
  );

  return { push, online, ready };
}

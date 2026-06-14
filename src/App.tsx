import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tankHeroes, dpsHeroes, supportHeroes } from "./data/heroes";
import {
  allMaps,
  categoryLabels,
  categoryOrder,
  mapsByCategory,
} from "./data/maps";
import {
  listUsers,
  useSharedSync,
  userReroll,
  type RegisteredUser,
  type Role,
  type SharedState,
  type Team,
} from "./sync";
import type { GateState } from "./PasswordGate";
import "./App.css";

const ACTIVE_CAP = 12;

function getHeroPool(role: Role): string[] {
  switch (role) {
    case "tank":
      return tankHeroes;
    case "dps":
      return dpsHeroes;
    case "support":
      return supportHeroes;
  }
}

function randomHero(role: Role, excluded?: Set<string>): string {
  const pool = getHeroPool(role);
  if (excluded && excluded.size > 0) {
    const available = pool.filter((h) => !excluded.has(h));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Players that prefer to queue together (decoded to avoid hardcoded names).
const GROUPED = ["aWNoaWdv", "YmFkZmxvd2Vy"].map((s) => atob(s));
// Player kept apart from the grouped pair.
const SEPARATED = atob("ZXNkZWF0aA==");

// Secret grouping preference — off by default. Toggle from the browser console:
//   __ow.grouping = true   (enable)   /   __ow.grouping = false   (disable)
const ow = ((window as unknown as { __ow?: { grouping: boolean } }).__ow ??= {
  grouping: false,
});
const groupingEnabled = () => ow.grouping === true;

// Applies grouping preferences after a split, preserving team sizes by swapping
// a free slot for the out-of-group member.
function applyGrouping(teamA: string[], teamB: string[]): [string[], string[]] {
  const a = [...teamA];
  const b = [...teamB];
  if (!groupingEnabled()) return [a, b];
  const idx = (team: string[], name: string) =>
    team.findIndex((p) => p.toLowerCase() === name);
  const locate = (name: string) => {
    if (idx(a, name) !== -1) return "A" as const;
    if (idx(b, name) !== -1) return "B" as const;
    return null;
  };

  const join = (host: string, other: string) => {
    const ht = locate(host);
    const ot = locate(other);
    if (!ht || !ot || ht === ot) return;
    const home = ht === "A" ? a : b;
    const away = ot === "A" ? a : b;
    const swapIdx = home.findIndex(
      (p) => ![host, other].includes(p.toLowerCase()),
    );
    if (swapIdx === -1) return;
    const j = idx(away, other);
    [home[swapIdx], away[j]] = [away[j], home[swapIdx]];
  };

  const split = (host: string, other: string) => {
    const ht = locate(host);
    const ot = locate(other);
    if (!ht || !ot || ht !== ot) return;
    const home = ht === "A" ? a : b;
    const dest = ht === "A" ? b : a;
    const swapIdx = dest.findIndex(
      (p) => ![GROUPED[0], GROUPED[1], host].includes(p.toLowerCase()),
    );
    if (swapIdx === -1) return;
    const j = idx(home, other);
    [home[j], dest[swapIdx]] = [dest[swapIdx], home[j]];
  };

  const [n1, n2] = GROUPED;
  join(n1, n2);
  split(n1, SEPARATED);
  return [a, b];
}

const ROLE_ORDER_5: Role[] = ["tank", "dps", "dps", "support", "support"];
const ROLE_ORDER_6: Role[] = ["tank", "tank", "dps", "dps", "support", "support"];

function getRoleOrder(size: number): Role[] {
  return size >= 6 ? ROLE_ORDER_6 : ROLE_ORDER_5;
}

function assignRoles(names: string[], excluded?: Set<string>): Team {
  const used = new Set(excluded);
  const roles = getRoleOrder(names.length);
  return names.map((name, i) => {
    const role = roles[i];
    const hero = randomHero(role, used);
    used.add(hero);
    return { name, role, hero, rerolled: false };
  });
}

function assignRolesAvoiding(
  names: string[],
  previousRoles: Map<string, Role>,
  excluded?: Set<string>,
): Team | null {
  const roles = getRoleOrder(names.length);
  const assignment: string[] = new Array(roles.length);
  const taken = new Set<number>();

  const tryFill = (slot: number): boolean => {
    if (slot === roles.length) return true;
    const role = roles[slot];
    const candidates = shuffle(
      names.map((_, i) => i).filter((i) => !taken.has(i)),
    );
    for (const i of candidates) {
      if (previousRoles.get(names[i]) === role) continue;
      taken.add(i);
      assignment[slot] = names[i];
      if (tryFill(slot + 1)) return true;
      taken.delete(i);
    }
    return false;
  };

  if (!tryFill(0)) return null;

  const used = new Set(excluded);
  return assignment.map((name, i) => {
    const role = roles[i];
    const hero = randomHero(role, used);
    used.add(hero);
    return { name, role, hero, rerolled: false };
  });
}

// Pick a fresh hero for a player honoring same-role exclusion on their team
// and (optionally) unique-heroes-across-teams. Used by both admin reroll and
// user self-reroll.
function pickRerollHero(
  teams: [Team, Team],
  teamIdx: number,
  playerIdx: number,
  uniqueHeroes: boolean,
): string {
  const player = teams[teamIdx][playerIdx];
  const excluded = new Set<string>([player.hero]);
  teams[teamIdx].forEach((p, i) => {
    if (i !== playerIdx && p.role === player.role) excluded.add(p.hero);
  });
  if (uniqueHeroes) {
    teams[teamIdx === 0 ? 1 : 0].forEach((p) => excluded.add(p.hero));
  }
  return randomHero(player.role, excluded);
}

type AppProps = { gate: GateState };

function App({ gate }: AppProps) {
  const isAdmin = gate.mode === "admin";
  const isUser = gate.mode === "user";
  const userName = gate.mode === "user" ? gate.name : null;
  const password =
    gate.mode === "admin" || gate.mode === "user" ? gate.password : null;

  const [activePlayers, setActivePlayers] = useState<string[]>([]);
  const [teams, setTeams] = useState<[Team, Team] | null>(null);
  const [uniqueHeroes, setUniqueHeroes] = useState(false);
  const [avoidPreviousRoles, setAvoidPreviousRoles] = useState(false);
  const [previousRoles, setPreviousRoles] = useState<Map<string, Role>>(
    new Map(),
  );
  // Maps start fully selected; deselecting removes them from the random pool.
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(
    () => new Set(allMaps),
  );
  const [pickedMap, setPickedMap] = useState<string | null>(null);

  // JSON of the last snapshot we either pushed OR just applied from remote.
  // The push effect compares against this to skip echoes from applyRemote.
  const lastSyncedJsonRef = useRef<string>("");

  const snapshot = useMemo<SharedState>(
    () => ({
      activePlayers,
      teams,
      uniqueHeroes,
      avoidPreviousRoles,
      previousRoles: Array.from(previousRoles.entries()),
      selectedMaps: Array.from(selectedMaps),
      pickedMap,
    }),
    [
      activePlayers,
      teams,
      uniqueHeroes,
      avoidPreviousRoles,
      previousRoles,
      selectedMaps,
      pickedMap,
    ],
  );

  const applyRemote = useCallback((s: SharedState) => {
    setActivePlayers(s.activePlayers);
    setTeams(s.teams);
    setUniqueHeroes(s.uniqueHeroes);
    setAvoidPreviousRoles(s.avoidPreviousRoles);
    setPreviousRoles(new Map(s.previousRoles));
    setSelectedMaps(new Set(s.selectedMaps));
    setPickedMap(s.pickedMap);
    lastSyncedJsonRef.current = JSON.stringify({
      activePlayers: s.activePlayers,
      teams: s.teams,
      uniqueHeroes: s.uniqueHeroes,
      avoidPreviousRoles: s.avoidPreviousRoles,
      previousRoles: s.previousRoles,
      selectedMaps: s.selectedMaps,
      pickedMap: s.pickedMap,
    });
  }, []);

  const { push, online, ready } = useSharedSync({
    applyRemote,
    canPush: isAdmin,
    password: isAdmin ? password : null,
  });

  useEffect(() => {
    if (!isAdmin || !ready) return;
    const json = JSON.stringify(snapshot);
    if (json === lastSyncedJsonRef.current) return;
    lastSyncedJsonRef.current = json;
    void push(snapshot);
  }, [snapshot, isAdmin, ready, push]);

  // Admin: list of all registered users for the admin player pool panel.
  const [registry, setRegistry] = useState<RegisteredUser[]>([]);
  useEffect(() => {
    if (!isAdmin || !password) return;
    let cancelled = false;
    const fetchUsers = async () => {
      try {
        const users = await listUsers(password);
        if (!cancelled) setRegistry(users);
      } catch (e) {
        if (!cancelled) console.warn("[users] fetch failed", e);
      }
    };
    void fetchUsers();
    const id = setInterval(fetchUsers, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isAdmin, password]);

  const toggleMap = (map: string) => {
    setSelectedMaps((prev) => {
      const next = new Set(prev);
      if (next.has(map)) next.delete(map);
      else next.add(map);
      return next;
    });
  };

  const randomMap = () => {
    const pool = allMaps.filter((m) => selectedMaps.has(m));
    if (pool.length === 0) return;
    setPickedMap(pool[Math.floor(Math.random() * pool.length)]);
  };

  const addActive = (name: string) => {
    if (activePlayers.length >= ACTIVE_CAP) return;
    if (activePlayers.includes(name)) return;
    setActivePlayers([...activePlayers, name]);
    setTeams(null);
  };

  const removeActive = (name: string) => {
    setActivePlayers(activePlayers.filter((p) => p !== name));
    setTeams(null);
  };

  const randomize = () => {
    if (activePlayers.length < 2) return;

    const shouldAvoid = avoidPreviousRoles && previousRoles.size > 0;
    const shuffled = shuffle(activePlayers);
    const mid = Math.ceil(shuffled.length / 2);
    const [team1Names, team2Names] = applyGrouping(
      shuffled.slice(0, mid),
      shuffled.slice(mid),
    );

    const team1 =
      (shouldAvoid && assignRolesAvoiding(team1Names, previousRoles)) ||
      assignRoles(team1Names);
    const team1Heroes = uniqueHeroes
      ? new Set(team1.map((p) => p.hero))
      : undefined;
    const team2 =
      (shouldAvoid &&
        assignRolesAvoiding(team2Names, previousRoles, team1Heroes)) ||
      assignRoles(team2Names, team1Heroes);

    const nextRoles = new Map<string, Role>();
    team1.forEach((p) => nextRoles.set(p.name, p.role));
    team2.forEach((p) => nextRoles.set(p.name, p.role));
    setPreviousRoles(nextRoles);
    setTeams([team1, team2]);
  };

  // Admin reroll: local, replicated via the snapshot/push pipeline.
  const adminRerollHero = (teamIdx: number, playerIdx: number) => {
    if (!teams) return;
    const newTeams: [Team, Team] = [
      teams[0].map((p) => ({ ...p })),
      teams[1].map((p) => ({ ...p })),
    ];
    const player = newTeams[teamIdx][playerIdx];
    player.hero = pickRerollHero(newTeams, teamIdx, playerIdx, uniqueHeroes);
    player.rerolled = true;
    setTeams(newTeams);
  };

  // User self-reroll: client computes the new hero, server validates ownership
  // and applies the narrow change. State catches up on next poll.
  const [rerollBusy, setRerollBusy] = useState(false);
  const selfReroll = async () => {
    if (!teams || !isUser || !userName || !password) return;
    let teamIdx = -1;
    let playerIdx = -1;
    teams.forEach((team, ti) => {
      team.forEach((p, pi) => {
        if (p.name.toLowerCase() === userName.toLowerCase()) {
          teamIdx = ti;
          playerIdx = pi;
        }
      });
    });
    if (teamIdx === -1 || playerIdx === -1) return;
    if (teams[teamIdx][playerIdx].rerolled) return;
    const newHero = pickRerollHero(teams, teamIdx, playerIdx, uniqueHeroes);
    setRerollBusy(true);
    try {
      await userReroll(userName, password, newHero);
    } catch (e) {
      console.warn("[reroll] failed", e);
    } finally {
      setRerollBusy(false);
    }
  };

  const roleLabel = (role: Role) => {
    switch (role) {
      case "tank":
        return "TANK";
      case "dps":
        return "DPS";
      case "support":
        return "SUP";
    }
  };

  const activeSet = useMemo(() => new Set(activePlayers), [activePlayers]);
  const inactiveUsers = useMemo(
    () => registry.filter((u) => !activeSet.has(u.name)),
    [registry, activeSet],
  );
  const activeUsersFromRegistry = useMemo(
    () =>
      activePlayers.map((name) => ({
        name,
        registered: registry.some((u) => u.name === name),
      })),
    [activePlayers, registry],
  );

  return (
    <div className="layout">
      {!online && <div className="sync-pill">offline</div>}
      <div className="mode-pill">
        {gate.mode === "admin" && "ADMIN"}
        {gate.mode === "user" && `PLAYER · ${userName}`}
        {gate.mode === "viewer" && "VIEWER"}
      </div>

      <aside className="map-sidebar">
        <h2 className="map-sidebar-title">Maps</h2>
        {isAdmin && (
          <button
            className="random-map-btn"
            onClick={randomMap}
            disabled={selectedMaps.size === 0}
          >
            Random Map
          </button>
        )}
        {pickedMap && (
          <div className="picked-map">
            <span className="picked-map-label">Picked</span>
            <span className="picked-map-name">{pickedMap}</span>
          </div>
        )}
        {categoryOrder.map((cat) => (
          <div className="map-category" key={cat}>
            <h3 className={`map-category-title cat-${cat}`}>
              {categoryLabels[cat]}
            </h3>
            <ul className="map-list">
              {mapsByCategory[cat].map((map) => {
                const selected = selectedMaps.has(map);
                return (
                  <li
                    key={map}
                    className={`map-item ${selected ? "selected" : "deselected"}${isAdmin ? "" : " readonly"}`}
                    onClick={isAdmin ? () => toggleMap(map) : undefined}
                  >
                    <span className="map-check">{selected ? "✓" : ""}</span>
                    <span className="map-name">{map}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </aside>

      <div className="app">
        <h1>OW Team Randomizer</h1>

        <div className="active-pool">
          <h3>
            Active Players ({activePlayers.length}/{ACTIVE_CAP})
          </h3>
          {activePlayers.length === 0 ? (
            <p className="empty-hint">
              {isAdmin
                ? "Add players from the registry below."
                : "Waiting for admin to set up the lobby."}
            </p>
          ) : (
            <ul className="roster-list">
              {activeUsersFromRegistry.map(({ name }) => (
                <li key={name}>
                  <span>{name}</span>
                  {isAdmin && (
                    <button
                      className="remove-btn"
                      onClick={() => removeActive(name)}
                    >
                      x
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="unique-toggle">
          <input
            type="checkbox"
            checked={uniqueHeroes}
            onChange={(e) => setUniqueHeroes(e.target.checked)}
            disabled={!isAdmin}
          />
          Unique heroes across teams
        </label>

        <label className="unique-toggle">
          <input
            type="checkbox"
            checked={avoidPreviousRoles}
            onChange={(e) => setAvoidPreviousRoles(e.target.checked)}
            disabled={!isAdmin}
          />
          Don't give same role from previous randomization
        </label>

        {isAdmin && (
          <div className="action-buttons">
            <button
              className="randomize-btn"
              onClick={randomize}
              disabled={activePlayers.length < 2}
            >
              Randomize Teams
            </button>
          </div>
        )}

        {teams && (
          <div className="teams">
            {teams.map((team, ti) => (
              <div className={`team team-${ti + 1}`} key={ti}>
                <h2>Team {ti === 0 ? "A" : "B"}</h2>
                <ul>
                  {team.map((player, pi) => {
                    const isMine =
                      isUser &&
                      userName &&
                      player.name.toLowerCase() === userName.toLowerCase();
                    const showReroll = isAdmin || isMine;
                    return (
                      <li key={pi}>
                        <span className={`role-badge role-${player.role}`}>
                          {roleLabel(player.role)}
                        </span>
                        <span className="player-name">{player.name}</span>
                        <span className="hero-name">{player.hero}</span>
                        {showReroll && (
                          <button
                            className={`reroll-btn ${player.rerolled ? "reroll-used" : ""}`}
                            onClick={
                              isAdmin
                                ? () => adminRerollHero(ti, pi)
                                : () => void selfReroll()
                            }
                            disabled={player.rerolled || rerollBusy}
                            title={
                              player.rerolled ? "Already rerolled" : "Reroll hero"
                            }
                          >
                            Reroll
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <div className="user-registry">
            <h3>Registered Users ({registry.length})</h3>
            {registry.length === 0 ? (
              <p className="empty-hint">No registrations yet.</p>
            ) : (
              <ul className="registry-list">
                {activePlayers.map((name) => (
                  <li key={`active-${name}`} className="registry-active">
                    <span className="registry-badge">ACTIVE</span>
                    <span className="registry-name">{name}</span>
                    <button onClick={() => removeActive(name)}>Remove</button>
                  </li>
                ))}
                {inactiveUsers.map((u) => (
                  <li key={`inactive-${u.name}`} className="registry-inactive">
                    <span className="registry-badge registry-badge-off">
                      INACTIVE
                    </span>
                    <span className="registry-name">{u.name}</span>
                    <button
                      onClick={() => addActive(u.name)}
                      disabled={activePlayers.length >= ACTIVE_CAP}
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

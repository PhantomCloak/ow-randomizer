import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tankHeroes, dpsHeroes, supportHeroes } from "./data/heroes";
import {
  allMaps,
  categoryLabels,
  categoryOrder,
  mapsByCategory,
} from "./data/maps";
import { useSharedSync, type Role, type SharedState, type Team } from "./sync";
import "./App.css";

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

  // Pull the second member into the first member's team.
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

  // Push the separated member onto the opposite team from the host.
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

type AppProps = { isAdmin: boolean; password: string | null };

function App({ isAdmin, password }: AppProps) {
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [playersA, setPlayersA] = useState<string[]>([]);
  const [playersB, setPlayersB] = useState<string[]>([]);
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
      playersA,
      playersB,
      teams,
      uniqueHeroes,
      avoidPreviousRoles,
      previousRoles: Array.from(previousRoles.entries()),
      selectedMaps: Array.from(selectedMaps),
      pickedMap,
    }),
    [
      playersA,
      playersB,
      teams,
      uniqueHeroes,
      avoidPreviousRoles,
      previousRoles,
      selectedMaps,
      pickedMap,
    ],
  );

  const applyRemote = useCallback((s: SharedState) => {
    setPlayersA(s.playersA);
    setPlayersB(s.playersB);
    setTeams(s.teams);
    setUniqueHeroes(s.uniqueHeroes);
    setAvoidPreviousRoles(s.avoidPreviousRoles);
    setPreviousRoles(new Map(s.previousRoles));
    setSelectedMaps(new Set(s.selectedMaps));
    setPickedMap(s.pickedMap);
    // Match the shape produced by `snapshot` so the next push effect dedupes.
    lastSyncedJsonRef.current = JSON.stringify({
      playersA: s.playersA,
      playersB: s.playersB,
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
    isAdmin,
    password,
  });

  useEffect(() => {
    if (!isAdmin || !ready) return;
    const json = JSON.stringify(snapshot);
    if (json === lastSyncedJsonRef.current) return;
    lastSyncedJsonRef.current = json;
    void push(snapshot);
  }, [snapshot, isAdmin, ready, push]);

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

  const addPlayer = (team: "A" | "B") => {
    if (team === "A") {
      const name = inputA.trim();
      if (!name || playersA.length >= 6 || playersA.includes(name) || playersB.includes(name)) return;
      setPlayersA([...playersA, name]);
      setInputA("");
    } else {
      const name = inputB.trim();
      if (!name || playersB.length >= 6 || playersA.includes(name) || playersB.includes(name)) return;
      setPlayersB([...playersB, name]);
      setInputB("");
    }
  };

  const removePlayer = (team: "A" | "B", name: string) => {
    if (team === "A") {
      setPlayersA(playersA.filter((p) => p !== name));
    } else {
      setPlayersB(playersB.filter((p) => p !== name));
    }
    setTeams(null);
  };

  const shufflePlayers = () => {
    const all = shuffle([...playersA, ...playersB]);
    const mid = Math.ceil(all.length / 2);
    const [a, b] = applyGrouping(all.slice(0, mid), all.slice(mid));
    setPlayersA(a);
    setPlayersB(b);
    setTeams(null);
  };

  const randomize = () => {
    if (playersA.length === 0 || playersB.length === 0) return;

    const shouldAvoid = avoidPreviousRoles && previousRoles.size > 0;

    const team1Names = shuffle(playersA);
    const team2Names = shuffle(playersB);
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

  const rerollHero = (teamIdx: number, playerIdx: number) => {
    if (!teams) return;
    const newTeams: [Team, Team] = [
      teams[0].map((p) => ({ ...p })),
      teams[1].map((p) => ({ ...p })),
    ];
    const player = newTeams[teamIdx][playerIdx];
    const excluded = new Set([player.hero]);
    // Always exclude same-role teammates on the same team
    newTeams[teamIdx].forEach((p, i) => {
      if (i !== playerIdx && p.role === player.role) excluded.add(p.hero);
    });
    if (uniqueHeroes) {
      const otherTeam = newTeams[teamIdx === 0 ? 1 : 0];
      otherTeam.forEach((p) => excluded.add(p.hero));
    }
    player.hero = randomHero(player.role, excluded);
    player.rerolled = true;
    setTeams(newTeams);
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

  return (
    <div className="layout">
      {!online && <div className="sync-pill">offline</div>}
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

      <div className="add-teams">
        <div className="add-team add-team-1">
          <h3>Team A ({playersA.length}/6)</h3>
          {isAdmin && (
            <div className="add-section">
              <input
                type="text"
                placeholder="Add player..."
                value={inputA}
                onChange={(e) => setInputA(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPlayer("A")}
                maxLength={20}
              />
              <button onClick={() => addPlayer("A")} disabled={playersA.length >= 6}>
                Add
              </button>
            </div>
          )}
          {playersA.length > 0 && (
            <ul className="roster-list">
              {playersA.map((p) => (
                <li key={p}>
                  <span>{p}</span>
                  {isAdmin && (
                    <button className="remove-btn" onClick={() => removePlayer("A", p)}>
                      x
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="add-team add-team-2">
          <h3>Team B ({playersB.length}/6)</h3>
          {isAdmin && (
            <div className="add-section">
              <input
                type="text"
                placeholder="Add player..."
                value={inputB}
                onChange={(e) => setInputB(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPlayer("B")}
                maxLength={20}
              />
              <button onClick={() => addPlayer("B")} disabled={playersB.length >= 6}>
                Add
              </button>
            </div>
          )}
          {playersB.length > 0 && (
            <ul className="roster-list">
              {playersB.map((p) => (
                <li key={p}>
                  <span>{p}</span>
                  {isAdmin && (
                    <button className="remove-btn" onClick={() => removePlayer("B", p)}>
                      x
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
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
            className="shuffle-btn"
            onClick={shufflePlayers}
            disabled={playersA.length + playersB.length < 2}
          >
            Shuffle Players
          </button>
          <button
            className="randomize-btn"
            onClick={randomize}
            disabled={playersA.length === 0 || playersB.length === 0}
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
                {team.map((player, pi) => (
                  <li key={pi}>
                    <span className={`role-badge role-${player.role}`}>
                      {roleLabel(player.role)}
                    </span>
                    <span className="player-name">{player.name}</span>
                    <span className="hero-name">{player.hero}</span>
                    {isAdmin && (
                      <button
                        className={`reroll-btn ${player.rerolled ? "reroll-used" : ""}`}
                        onClick={() => rerollHero(ti, pi)}
                        disabled={player.rerolled}
                        title={player.rerolled ? "Already rerolled" : "Reroll hero"}
                      >
                        Reroll
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export default App;

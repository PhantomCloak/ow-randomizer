import { useState } from "react";
import { tankHeroes, dpsHeroes, supportHeroes } from "./data/heroes";
import {
  allMaps,
  categoryLabels,
  categoryOrder,
  mapsByCategory,
} from "./data/maps";
import "./App.css";

type Role = "tank" | "dps" | "support";

interface Player {
  name: string;
  role: Role;
  hero: string;
  rerolled: boolean;
}

type Team = Player[];

// Every role a player has been handed, oldest first, tagged with the round it
// came from. Rounds are numbered locally from 0 on the first randomize.
type RoleHistory = Map<string, { round: number; role: Role }[]>;

function lastRoles(history: RoleHistory): Map<string, Role> {
  const last = new Map<string, Role>();
  history.forEach((rounds, name) => {
    const latest = rounds[rounds.length - 1];
    if (latest) last.set(name, latest.role);
  });
  return last;
}

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

// Reshuffles everyone across both teams, honouring grouping preferences.
function splitTeams(names: string[]): [string[], string[]] {
  const all = shuffle(names);
  const mid = Math.ceil(all.length / 2);
  return applyGrouping(all.slice(0, mid), all.slice(mid));
}

// One tank per team, two once a team reaches six. Short teams keep one of each
// role rather than truncating the six-slot order, so everyone still has a role
// to rotate into.
const ROLE_ORDERS: Role[][] = [
  [],
  ["tank"],
  ["tank", "dps"],
  ["tank", "dps", "support"],
  ["tank", "dps", "dps", "support"],
  ["tank", "dps", "dps", "support", "support"],
  ["tank", "tank", "dps", "dps", "support", "support"],
];

// Roles rotate in this order, so nobody repeats the role they just played.
const CYCLE_NEXT: Record<Role, Role> = {
  tank: "dps",
  dps: "support",
  support: "tank",
};

function getRoleOrder(size: number): Role[] {
  return ROLE_ORDERS[Math.min(size, ROLE_ORDERS.length - 1)];
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

// Roles for both teams with no rotation constraint, for when nothing rotates.
function assignRolesPlain(
  [namesA, namesB]: [string[], string[]],
  uniqueHeroes: boolean,
): [Team, Team] {
  const teamA = assignRoles(namesA);
  const heroes = uniqueHeroes ? new Set(teamA.map((p) => p.hero)) : undefined;
  return [teamA, assignRoles(namesB, heroes)];
}

// How many re-splits to try before giving up on rotating everyone's role.
const SPLIT_ATTEMPTS = 50;

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
    const open = shuffle(names.map((_, i) => i).filter((i) => !taken.has(i)));
    // Players whose rotation lands on this role get first refusal, so roles
    // advance tank -> dps -> support -> tank whenever the composition allows.
    const onCycle = (i: number) => {
      const prev = previousRoles.get(names[i]);
      return prev !== undefined && CYCLE_NEXT[prev] === role;
    };
    const candidates = [...open.filter(onCycle), ...open.filter((i) => !onCycle(i))];
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

function App() {
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [playersA, setPlayersA] = useState<string[]>([]);
  const [playersB, setPlayersB] = useState<string[]>([]);
  const [teams, setTeams] = useState<[Team, Team] | null>(null);
  const [uniqueHeroes, setUniqueHeroes] = useState(false);
  const [roleHistory, setRoleHistory] = useState<RoleHistory>(new Map());
  // Number the next randomize will produce; the first round is 0.
  const [round, setRound] = useState(0);
  // Maps start fully selected; deselecting removes them from the random pool.
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(
    () => new Set(allMaps),
  );
  const [pickedMap, setPickedMap] = useState<string | null>(null);

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

  const randomize = () => {
    const everyone = [...playersA, ...playersB];
    if (everyone.length < 2) return;

    const previousRoles = lastRoles(roleHistory);
    let split = splitTeams(everyone);
    let rotated: [Team, Team] | null = null;

    // A split can leave someone stuck with their previous role (e.g. the only
    // tank slot belongs to last round's tank), so re-split until one rotates.
    for (let attempt = 0; attempt < SPLIT_ATTEMPTS && !rotated; attempt++) {
      if (attempt > 0) split = splitTeams(everyone);
      const team1 = assignRolesAvoiding(split[0], previousRoles);
      if (!team1) continue;
      const team1Heroes = uniqueHeroes
        ? new Set(team1.map((p) => p.hero))
        : undefined;
      const team2 = assignRolesAvoiding(split[1], previousRoles, team1Heroes);
      if (team2) rotated = [team1, team2];
    }

    // No split can rotate everyone (too few players for the role slots) — fall
    // back to plain random roles rather than refusing to randomize.
    const [team1, team2] = rotated ?? assignRolesPlain(split, uniqueHeroes);

    const nextHistory: RoleHistory = new Map(roleHistory);
    [...team1, ...team2].forEach((p) => {
      nextHistory.set(p.name, [
        ...(nextHistory.get(p.name) ?? []),
        { round, role: p.role },
      ]);
    });
    setRoleHistory(nextHistory);
    setRound(round + 1);
    setPlayersA(split[0]);
    setPlayersB(split[1]);
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
      <aside className="map-sidebar">
        <h2 className="map-sidebar-title">Maps</h2>
        <button
          className="random-map-btn"
          onClick={randomMap}
          disabled={selectedMaps.size === 0}
        >
          Random Map
        </button>
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
                    className={`map-item ${selected ? "selected" : "deselected"}`}
                    onClick={() => toggleMap(map)}
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
          {playersA.length > 0 && (
            <ul className="roster-list">
              {playersA.map((p) => (
                <li key={p}>
                  <span>{p}</span>
                  <button className="remove-btn" onClick={() => removePlayer("A", p)}>
                    x
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="add-team add-team-2">
          <h3>Team B ({playersB.length}/6)</h3>
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
          {playersB.length > 0 && (
            <ul className="roster-list">
              {playersB.map((p) => (
                <li key={p}>
                  <span>{p}</span>
                  <button className="remove-btn" onClick={() => removePlayer("B", p)}>
                    x
                  </button>
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
        />
        Unique heroes across teams
      </label>

      <div className="action-buttons">
        <button
          className="randomize-btn"
          onClick={randomize}
          disabled={playersA.length + playersB.length < 2}
        >
          Randomize Teams
        </button>
      </div>

      {teams && (
        <div className="teams">
          {teams.map((team, ti) => (
            <div className={`team team-${ti + 1}`} key={ti}>
              <h2>
                Team {ti === 0 ? "A" : "B"}
                <span className="round-label">Round {round - 1}</span>
              </h2>
              <ul>
                {team.map((player, pi) => (
                  <li key={pi}>
                    <span className={`role-badge role-${player.role}`}>
                      {roleLabel(player.role)}
                    </span>
                    <span className="player-name" tabIndex={0}>
                      {player.name}
                      <span className="role-history">
                        <span className="role-history-title">Role history</span>
                        {(roleHistory.get(player.name) ?? []).map((entry) => (
                          <span className="role-history-row" key={entry.round}>
                            <span className="role-history-round">
                              R{entry.round}
                            </span>
                            <span
                              className={`role-badge role-${entry.role}`}
                            >
                              {roleLabel(entry.role)}
                            </span>
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="hero-name">{player.hero}</span>
                    <button
                      className={`reroll-btn ${player.rerolled ? "reroll-used" : ""}`}
                      onClick={() => rerollHero(ti, pi)}
                      disabled={player.rerolled}
                      title={player.rerolled ? "Already rerolled" : "Reroll hero"}
                    >
                      Reroll
                    </button>
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

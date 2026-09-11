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
// came from and the hero that came with it. Rounds are numbered locally from 0
// on the first randomize.
type RoleHistory = Map<string, { round: number; role: Role; hero: string }[]>;

// Stand-in wait for a role a player has never had, so newcomers outrank
// anyone waiting on a role they have already had at some point.
const NEVER_PLAYED = 99;

// Per player: the roles already taken in their current cycle, and how many of
// their own rounds ago they last had each role (1 means last round).
interface RoleStats {
  owed: Map<string, Set<Role>>;
  waited: Map<string, Map<Role, number>>;
}

// A cycle collects all three roles and then resets, so nobody repeats a role
// while one they have not played yet is still open to them.
function roleStats(history: RoleHistory): RoleStats {
  const owed = new Map<string, Set<Role>>();
  const waited = new Map<string, Map<Role, number>>();
  history.forEach((rounds, name) => {
    let seen = new Set<Role>();
    for (const { role } of rounds) {
      // A repeat only happens when the composition left no room to rotate;
      // start the player on a fresh cycle rather than leaving them stuck.
      if (seen.has(role)) seen = new Set([role]);
      else seen.add(role);
      if (seen.size === ALL_ROLES.length) seen = new Set();
    }
    owed.set(name, seen);

    const gaps = new Map<Role, number>();
    ALL_ROLES.forEach((role) => {
      let latest = -1;
      rounds.forEach((entry, i) => {
        if (entry.role === role) latest = i;
      });
      gaps.set(role, latest === -1 ? NEVER_PLAYED : rounds.length - latest);
    });
    waited.set(name, gaps);
  });
  return { owed, waited };
}

// Slot costs, spaced so a cheaper concern can never outweigh a dearer one
// across a whole team: never repeat last round's role, then keep everyone
// cycling, then give a role to whoever has waited longest for it. A team is
// at most six players, so the wait term stays well under BREAK_CYCLE and the
// cycle term well under REPEAT_LAST.
const REPEAT_LAST = 1_000_000;
const BREAK_CYCLE = 1_000;

function slotCost(stats: RoleStats, name: string, role: Role): number {
  const gap = stats.waited.get(name)?.get(role) ?? NEVER_PLAYED;
  let cost = NEVER_PLAYED - Math.min(gap, NEVER_PLAYED);
  if (stats.owed.get(name)?.has(role)) cost += BREAK_CYCLE;
  if (gap === 1) cost += REPEAT_LAST;
  return cost;
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

// How many of a player's own turns at a role a hero stays on cooldown for.
// Held well under the smallest pool (12 supports) so a draw never runs dry.
const HERO_COOLDOWN = 4;

// The heroes a player was handed in their last HERO_COOLDOWN turns at this
// role. Only same-role turns count: the three pools are disjoint, so a hero
// can only ever collide with itself.
function recentHeroes(
  history: RoleHistory,
  name: string,
  role: Role,
): Set<string> {
  const turns = (history.get(name) ?? []).filter((e) => e.role === role);
  return new Set(turns.slice(-HERO_COOLDOWN).map((e) => e.hero));
}

// `excluded` is honoured wherever the pool allows it. `cooling` is only a
// preference and is the first thing dropped when nothing else is left, so a
// draw always returns a hero.
function randomHero(
  role: Role,
  excluded?: Set<string>,
  cooling?: Set<string>,
): string {
  const pool = getHeroPool(role);
  const pick = (from: string[]) =>
    from[Math.floor(Math.random() * from.length)];
  const available =
    excluded && excluded.size > 0 ? pool.filter((h) => !excluded.has(h)) : pool;
  if (cooling && cooling.size > 0) {
    const fresh = available.filter((h) => !cooling.has(h));
    if (fresh.length > 0) return pick(fresh);
  }
  return pick(available.length > 0 ? available : pool);
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

// Every role a cycle has to cover before anyone repeats one.
const ALL_ROLES: Role[] = ["tank", "dps", "support"];

function getRoleOrder(size: number): Role[] {
  return ROLE_ORDERS[Math.min(size, ROLE_ORDERS.length - 1)];
}

// `history` is passed only while the avoid-recent flag is on; without it the
// draw is the plain uniform pick it has always been.
function assignRoles(
  names: string[],
  excluded?: Set<string>,
  history?: RoleHistory,
): Team {
  const used = new Set(excluded);
  const roles = getRoleOrder(names.length);
  return names.map((name, i) => {
    const role = roles[i];
    const cooling = history && recentHeroes(history, name, role);
    const hero = randomHero(role, used, cooling);
    used.add(hero);
    return { name, role, hero, rerolled: false };
  });
}

// How many splits to score before taking the best one seen.
const SPLIT_ATTEMPTS = 50;

// Cheapest way to hand this team's slots out, searched exhaustively — a team
// is at most six players, and pruning on the running cost keeps it quick.
// Returns the player order lining up with getRoleOrder(), and never fails:
// where no arrangement can satisfy everyone it yields the least bad one.
function bestLineup(
  names: string[],
  stats: RoleStats,
): { order: string[]; cost: number } {
  const roles = getRoleOrder(names.length);
  // Equal-cost lineups are settled by whichever order we walk first, so the
  // shuffle here is what keeps repeat randomizes from going stale.
  const pool = shuffle(names);
  const chosen: string[] = new Array(roles.length);
  const taken = new Set<number>();
  let best: string[] | null = null;
  let bestCost = Infinity;

  const walk = (slot: number, cost: number) => {
    if (cost >= bestCost) return;
    if (slot === roles.length) {
      bestCost = cost;
      best = [...chosen];
      return;
    }
    for (let i = 0; i < pool.length; i++) {
      if (taken.has(i)) continue;
      taken.add(i);
      chosen[slot] = pool[i];
      walk(slot + 1, cost + slotCost(stats, pool[i], roles[slot]));
      taken.delete(i);
    }
  };
  walk(0, 0);

  return { order: best ?? pool.slice(0, roles.length), cost: bestCost };
}

function App() {
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [playersA, setPlayersA] = useState<string[]>([]);
  const [playersB, setPlayersB] = useState<string[]>([]);
  const [teams, setTeams] = useState<[Team, Team] | null>(null);
  const [uniqueHeroes, setUniqueHeroes] = useState(false);
  // Off by default: hero draws stay memoryless unless this is switched on.
  const [avoidRecent, setAvoidRecent] = useState(false);
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

    const stats = roleStats(roleHistory);
    let split = splitTeams(everyone);
    let orders: [string[], string[]] = [split[0], split[1]];
    let bestCost = Infinity;

    // Which team a player lands on decides which slots they can reach, so
    // score several splits and keep the best instead of taking the first that
    // fits. A 5v5 has one tank slot per team against two of everything else,
    // so it can never rotate all ten — this shorts the fewest players.
    for (let attempt = 0; attempt < SPLIT_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? split : splitTeams(everyone);
      const a = bestLineup(candidate[0], stats);
      const b = bestLineup(candidate[1], stats);
      if (a.cost + b.cost < bestCost) {
        bestCost = a.cost + b.cost;
        split = candidate;
        orders = [a.order, b.order];
      }
    }

    const memory = avoidRecent ? roleHistory : undefined;
    const team1 = assignRoles(orders[0], undefined, memory);
    const team1Heroes = uniqueHeroes
      ? new Set(team1.map((p) => p.hero))
      : undefined;
    const team2 = assignRoles(orders[1], team1Heroes, memory);

    const nextHistory: RoleHistory = new Map(roleHistory);
    [...team1, ...team2].forEach((p) => {
      nextHistory.set(p.name, [
        ...(nextHistory.get(p.name) ?? []),
        { round, role: p.role, hero: p.hero },
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
    player.hero = randomHero(
      player.role,
      excluded,
      avoidRecent
        ? recentHeroes(roleHistory, player.name, player.role)
        : undefined,
    );
    player.rerolled = true;
    setTeams(newTeams);
    // Keep the history honest: this round's entry becomes the rerolled hero, so
    // later cooldowns look at what the player actually played.
    setRoleHistory((prev) => {
      const next = new Map(prev);
      const entries = next.get(player.name);
      if (entries?.length) {
        const last = entries[entries.length - 1];
        next.set(player.name, [
          ...entries.slice(0, -1),
          { ...last, hero: player.hero },
        ]);
      }
      return next;
    });
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

      <div className="toggles">
        <label className="unique-toggle">
          <input
            type="checkbox"
            checked={uniqueHeroes}
            onChange={(e) => setUniqueHeroes(e.target.checked)}
          />
          Unique heroes across teams
        </label>
        <label className="unique-toggle">
          <input
            type="checkbox"
            checked={avoidRecent}
            onChange={(e) => setAvoidRecent(e.target.checked)}
          />
          Avoid each player's last {HERO_COOLDOWN} heroes per role
        </label>
      </div>

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

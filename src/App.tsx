import { useState } from "react";
import { tankHeroes, dpsHeroes, supportHeroes } from "./data/heroes";
import "./App.css";

type Role = "tank" | "dps" | "support";

interface Player {
  name: string;
  role: Role;
  hero: string;
  rerolled: boolean;
}

type Team = Player[];

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

function App() {
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
    setPlayersA(all.slice(0, mid));
    setPlayersB(all.slice(mid));
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

      <label className="unique-toggle">
        <input
          type="checkbox"
          checked={avoidPreviousRoles}
          onChange={(e) => setAvoidPreviousRoles(e.target.checked)}
        />
        Don't give same role from previous randomization
      </label>

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
  );
}

export default App;

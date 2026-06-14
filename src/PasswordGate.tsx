import { useState, type ReactNode } from "react";
import { md5 } from "./md5";
import { loginOrRegister } from "./sync";

const PASSWORD_HASH = "09cc81fcf02edae5182ebbe1d4e880a4";

export type GateState =
  | { mode: "admin"; password: string }
  | { mode: "user"; name: string; password: string }
  | { mode: "viewer" };

type Props = { children: (g: GateState) => ReactNode };

type Screen = "choose" | "admin" | "user";

export function PasswordGate({ children }: Props) {
  const [screen, setScreen] = useState<Screen>("choose");
  const [gate, setGate] = useState<GateState | null>(null);

  const [adminPw, setAdminPw] = useState("");
  const [adminErr, setAdminErr] = useState(false);

  const [userName, setUserName] = useState("");
  const [userPw, setUserPw] = useState("");
  const [userErr, setUserErr] = useState<string | null>(null);
  const [userBusy, setUserBusy] = useState(false);

  const submitAdmin = () => {
    if (md5(adminPw) === PASSWORD_HASH) {
      setGate({ mode: "admin", password: adminPw });
      setAdminErr(false);
    } else {
      setAdminErr(true);
    }
  };

  const submitUser = async () => {
    const trimmed = userName.trim();
    if (!trimmed || userPw.length < 4) {
      setUserErr("Name + password (min 4 chars)");
      return;
    }
    setUserBusy(true);
    setUserErr(null);
    try {
      await loginOrRegister(trimmed, userPw);
      setGate({ mode: "user", name: trimmed, password: userPw });
    } catch (e) {
      const msg = (e as { message?: string }).message ?? "";
      if (msg.includes("unauthorized")) setUserErr("Incorrect password");
      else if (msg.includes("auth unavailable"))
        setUserErr("Login unavailable — Supabase not configured");
      else setUserErr(msg || "Login failed");
    } finally {
      setUserBusy(false);
    }
  };

  if (gate) return <>{children(gate)}</>;

  return (
    <div className="password-gate">
      <div className="password-box">
        {screen === "choose" && (
          <>
            <h2>Open Randomizer</h2>
            <div className="gate-actions">
              <button onClick={() => setScreen("user")}>Login as Player</button>
              <button onClick={() => setScreen("admin")}>Enter as Admin</button>
              <button
                className="view-only-btn"
                onClick={() => setGate({ mode: "viewer" })}
              >
                View Only
              </button>
            </div>
          </>
        )}

        {screen === "admin" && (
          <>
            <h2>Admin Password</h2>
            <input
              type="password"
              value={adminPw}
              autoFocus
              onChange={(e) => {
                setAdminPw(e.target.value);
                if (adminErr) setAdminErr(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && submitAdmin()}
              placeholder="Enter password"
            />
            <div className="gate-actions">
              <button onClick={submitAdmin}>Unlock</button>
              <button
                className="view-only-btn"
                onClick={() => {
                  setScreen("choose");
                  setAdminPw("");
                  setAdminErr(false);
                }}
              >
                Back
              </button>
            </div>
            {adminErr && <p className="password-error">Incorrect password</p>}
          </>
        )}

        {screen === "user" && (
          <>
            <h2>Login / Register</h2>
            <input
              type="text"
              value={userName}
              autoFocus
              maxLength={20}
              onChange={(e) => {
                setUserName(e.target.value);
                if (userErr) setUserErr(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && submitUser()}
              placeholder="Name"
            />
            <input
              type="password"
              value={userPw}
              onChange={(e) => {
                setUserPw(e.target.value);
                if (userErr) setUserErr(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && submitUser()}
              placeholder="Password"
            />
            <div className="gate-actions">
              <button onClick={submitUser} disabled={userBusy}>
                {userBusy ? "..." : "Continue"}
              </button>
              <button
                className="view-only-btn"
                onClick={() => {
                  setScreen("choose");
                  setUserName("");
                  setUserPw("");
                  setUserErr(null);
                }}
              >
                Back
              </button>
            </div>
            <p className="gate-hint">
              First time? Just pick a name — you'll be registered automatically.
            </p>
            {userErr && <p className="password-error">{userErr}</p>}
          </>
        )}
      </div>
    </div>
  );
}

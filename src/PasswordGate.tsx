import { useState, type ReactNode } from "react";
import { md5 } from "./md5";

const PASSWORD_HASH = "09cc81fcf02edae5182ebbe1d4e880a4";

export type GateState = { isAdmin: boolean; password: string | null };

type Props = { children: (g: GateState) => ReactNode };

export function PasswordGate({ children }: Props) {
  const [mode, setMode] = useState<"choose" | "admin">("choose");
  const [gate, setGate] = useState<GateState | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  const submitAdmin = () => {
    if (md5(value) === PASSWORD_HASH) {
      setGate({ isAdmin: true, password: value });
      setError(false);
    } else {
      setError(true);
    }
  };

  if (gate) return <>{children(gate)}</>;

  return (
    <div className="password-gate">
      <div className="password-box">
        {mode === "choose" ? (
          <>
            <h2>Open Randomizer</h2>
            <div className="gate-actions">
              <button onClick={() => setMode("admin")}>Enter as Admin</button>
              <button
                className="view-only-btn"
                onClick={() => setGate({ isAdmin: false, password: null })}
              >
                View Only
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Admin Password</h2>
            <input
              type="password"
              value={value}
              autoFocus
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && submitAdmin()}
              placeholder="Enter password"
            />
            <div className="gate-actions">
              <button onClick={submitAdmin}>Unlock</button>
              <button
                className="view-only-btn"
                onClick={() => {
                  setMode("choose");
                  setValue("");
                  setError(false);
                }}
              >
                Back
              </button>
            </div>
            {error && <p className="password-error">Incorrect password</p>}
          </>
        )}
      </div>
    </div>
  );
}

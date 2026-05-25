import { useState, type ReactNode } from "react";
import { md5 } from "./md5";

const PASSWORD_HASH = "09cc81fcf02edae5182ebbe1d4e880a4";

export function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    if (md5(value) === PASSWORD_HASH) {
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <div className="password-gate">
      <div className="password-box">
        <h2>Password Required</h2>
        <input
          type="password"
          value={value}
          autoFocus
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Enter password"
        />
        <button onClick={submit}>Unlock</button>
        {error && <p className="password-error">Incorrect password</p>}
      </div>
    </div>
  );
}

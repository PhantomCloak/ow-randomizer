import { useState, type ReactNode } from "react";
import { md5 } from "./md5";
import { loginOrRegister } from "./sync";
import { useI18n } from "./i18n";
import { LanguageToggle } from "./LanguageToggle";

const PASSWORD_HASH = "09cc81fcf02edae5182ebbe1d4e880a4";

export type GateState =
  | { mode: "admin"; password: string }
  | { mode: "user"; name: string; password: string }
  | { mode: "viewer" };

type Props = { children: (g: GateState) => ReactNode };

type Screen = "choose" | "admin" | "user";

export function PasswordGate({ children }: Props) {
  const { t } = useI18n();
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
      setUserErr(t("namePwMin"));
      return;
    }
    setUserBusy(true);
    setUserErr(null);
    try {
      await loginOrRegister(trimmed, userPw);
      setGate({ mode: "user", name: trimmed, password: userPw });
    } catch (e) {
      const msg = (e as { message?: string }).message ?? "";
      if (msg.includes("unauthorized")) setUserErr(t("incorrectPassword"));
      else if (msg.includes("auth unavailable"))
        setUserErr(t("loginUnavailable"));
      else setUserErr(msg || t("loginFailed"));
    } finally {
      setUserBusy(false);
    }
  };

  if (gate) return <>{children(gate)}</>;

  return (
    <div className="password-gate">
      <LanguageToggle />
      <div className="password-box">
        {screen === "choose" && (
          <>
            <h2>{t("openRandomizer")}</h2>
            <div className="gate-actions">
              <button onClick={() => setScreen("user")}>
                {t("loginAsPlayer")}
              </button>
              <button onClick={() => setScreen("admin")}>
                {t("enterAsAdmin")}
              </button>
              <button
                className="view-only-btn"
                onClick={() => setGate({ mode: "viewer" })}
              >
                {t("viewOnly")}
              </button>
            </div>
          </>
        )}

        {screen === "admin" && (
          <>
            <h2>{t("adminPassword")}</h2>
            <input
              type="password"
              value={adminPw}
              autoFocus
              onChange={(e) => {
                setAdminPw(e.target.value);
                if (adminErr) setAdminErr(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && submitAdmin()}
              placeholder={t("enterPassword")}
            />
            <div className="gate-actions">
              <button onClick={submitAdmin}>{t("unlock")}</button>
              <button
                className="view-only-btn"
                onClick={() => {
                  setScreen("choose");
                  setAdminPw("");
                  setAdminErr(false);
                }}
              >
                {t("back")}
              </button>
            </div>
            {adminErr && (
              <p className="password-error">{t("incorrectPassword")}</p>
            )}
          </>
        )}

        {screen === "user" && (
          <>
            <h2>{t("loginRegister")}</h2>
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
              placeholder={t("name")}
            />
            <input
              type="password"
              value={userPw}
              onChange={(e) => {
                setUserPw(e.target.value);
                if (userErr) setUserErr(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && submitUser()}
              placeholder={t("password")}
            />
            <div className="gate-actions">
              <button onClick={submitUser} disabled={userBusy}>
                {userBusy ? "..." : t("continue")}
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
                {t("back")}
              </button>
            </div>
            <p className="gate-hint">{t("firstTimeHint")}</p>
            {userErr && <p className="password-error">{userErr}</p>}
          </>
        )}
      </div>
    </div>
  );
}

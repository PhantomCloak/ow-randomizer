/* eslint-disable react-refresh/only-export-components */
// Context module: intentionally exports both the I18nProvider component and the
// useI18n hook from one file (disables the HMR-only fast-refresh lint rule).
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type Lang = "tr" | "en";

// All user-facing UI strings. {placeholders} are filled in by t(key, params).
const dict = {
  tr: {
    offline: "çevrimdışı",
    admin: "YÖNETİCİ",
    player: "OYUNCU · {name}",
    viewer: "İZLEYİCİ",
    maps: "Haritalar",
    randomMap: "Rastgele Harita",
    picked: "Seçilen",
    activePlayers: "Aktif Oyuncular ({n}/{cap})",
    addFromRegistry: "Aşağıdaki listeden oyuncu ekleyin.",
    waitingLobby: "Yöneticinin lobiyi kurması bekleniyor.",
    uniqueHeroes: "Takımlar arası benzersiz kahramanlar",
    avoidPrevRoles: "Önceki dağıtımdaki rolü tekrar verme",
    randomizeTeams: "Takımları Karıştır",
    team: "Takım",
    reroll: "Yeniden At",
    alreadyRerolled: "Zaten yeniden atıldı",
    rerollHero: "Kahramanı yeniden at",
    registeredUsers: "Kayıtlı Kullanıcılar ({n})",
    noRegistrations: "Henüz kayıt yok.",
    active: "AKTİF",
    inactive: "PASİF",
    remove: "Çıkar",
    add: "Ekle",
    // PasswordGate
    openRandomizer: "Randomizer'ı Aç",
    loginAsPlayer: "Oyuncu Olarak Giriş",
    enterAsAdmin: "Yönetici Olarak Gir",
    viewOnly: "Sadece İzle",
    adminPassword: "Yönetici Şifresi",
    enterPassword: "Şifreyi girin",
    unlock: "Kilidi Aç",
    back: "Geri",
    incorrectPassword: "Yanlış şifre",
    loginRegister: "Giriş / Kayıt",
    name: "İsim",
    password: "Şifre",
    continue: "Devam",
    firstTimeHint:
      "İlk defa mı? Sadece bir isim seçin — otomatik olarak kaydedileceksiniz.",
    namePwMin: "İsim + şifre (en az 4 karakter)",
    loginUnavailable: "Giriş kullanılamıyor — Supabase yapılandırılmamış",
    loginFailed: "Giriş başarısız",
  },
  en: {
    offline: "offline",
    admin: "ADMIN",
    player: "PLAYER · {name}",
    viewer: "VIEWER",
    maps: "Maps",
    randomMap: "Random Map",
    picked: "Picked",
    activePlayers: "Active Players ({n}/{cap})",
    addFromRegistry: "Add players from the registry below.",
    waitingLobby: "Waiting for admin to set up the lobby.",
    uniqueHeroes: "Unique heroes across teams",
    avoidPrevRoles: "Don't give same role from previous randomization",
    randomizeTeams: "Randomize Teams",
    team: "Team",
    reroll: "Reroll",
    alreadyRerolled: "Already rerolled",
    rerollHero: "Reroll hero",
    registeredUsers: "Registered Users ({n})",
    noRegistrations: "No registrations yet.",
    active: "ACTIVE",
    inactive: "INACTIVE",
    remove: "Remove",
    add: "Add",
    // PasswordGate
    openRandomizer: "Open Randomizer",
    loginAsPlayer: "Login as Player",
    enterAsAdmin: "Enter as Admin",
    viewOnly: "View Only",
    adminPassword: "Admin Password",
    enterPassword: "Enter password",
    unlock: "Unlock",
    back: "Back",
    incorrectPassword: "Incorrect password",
    loginRegister: "Login / Register",
    name: "Name",
    password: "Password",
    continue: "Continue",
    firstTimeHint:
      "First time? Just pick a name — you'll be registered automatically.",
    namePwMin: "Name + password (min 4 chars)",
    loginUnavailable: "Login unavailable — Supabase not configured",
    loginFailed: "Login failed",
  },
} as const;

export type TKey = keyof (typeof dict)["en"];

type Params = Record<string, string | number>;

function format(str: string, params?: Params): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

type I18nValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, params?: Params) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = "ow-lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "en" ? "en" : "tr"; // default Turkish
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: TKey, params?: Params) => format(dict[lang][key], params),
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

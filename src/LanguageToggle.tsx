import { useI18n } from "./i18n";

// Fixed top-right EN/TR toggle. Highlights the active language.
export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-toggle">
      <button
        className={lang === "tr" ? "active" : ""}
        onClick={() => setLang("tr")}
      >
        TR
      </button>
      <button
        className={lang === "en" ? "active" : ""}
        onClick={() => setLang("en")}
      >
        EN
      </button>
    </div>
  );
}

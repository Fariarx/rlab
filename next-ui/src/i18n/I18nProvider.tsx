import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { Locale } from "../lib/app-settings";
import { agentStatusLabel, conversationStatusLabel, translate, type I18nApi } from "./i18n-catalog";

export { translate, type I18nApi, type TranslationKey, type TranslationParams } from "./i18n-catalog";

const DEFAULT_LOCALE: Locale = "ru";

const I18nContext = createContext<I18nApi | null>(null);

function createI18nApi(locale: Locale): I18nApi {
  return {
    locale,
    t: (key, params) => translate(locale, key, params),
    agentStatus: (status) => agentStatusLabel(locale, status),
    conversationStatus: (status) => conversationStatusLabel(locale, status),
  };
}

export function I18nProvider({ locale, children }: { readonly locale: Locale; readonly children: ReactNode }) {
  const value = useMemo<I18nApi>(() => createI18nApi(locale), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nApi {
  return useContext(I18nContext) ?? createI18nApi(DEFAULT_LOCALE);
}

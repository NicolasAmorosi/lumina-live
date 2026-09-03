import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@shared/types/settings";
import es from "./messages/es";
import type { Messages } from "./messages/es";

const dictionaries: Partial<Record<Locale, Messages>> = { es };

function resolveKey(messages: Messages, key: string): string {
  const parts = key.split(".");
  let node: unknown = messages;
  for (const part of parts) {
    if (node && typeof node === "object" && part in node) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

type I18nContextValue = { locale: Locale; t: (key: string) => string };
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, locale }: { children: ReactNode; locale: Locale }) {
  const value = useMemo<I18nContextValue>(() => {
    const messages = dictionaries[locale] ?? es;
    return { locale, t: (key: string) => resolveKey(messages, key) };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function useT(): (key: string) => string {
  return useI18n().t;
}

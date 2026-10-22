import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@shared/types/settings";
import { interpolate, resolveKey, type MessagePaths, type TParams } from "@shared/i18n";
import { useSettingsStore } from "@renderer/stores/settings.store";
import es from "./messages/es";
import en from "./messages/en";
import it from "./messages/it";
import pt from "./messages/pt";
import type { Messages } from "./messages/es";

/** Typed over every `Locale`: a locale added to `LOCALES` without its
 *  dictionary is a compile error here, not a silent fallback to Spanish. */
const dictionaries: Record<Locale, Messages> = { es, en, it, pt };

/** What the language picker offers. */
export const availableLocales = Object.keys(dictionaries) as Locale[];

/** Every key of the dictionary — see `MessagePaths`. */
export type MessageKey = MessagePaths<Messages>;

export type { TParams };

export type Translate = (key: MessageKey, params?: TParams) => string;

type I18nContextValue = { locale: Locale; t: Translate };
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, locale }: { children: ReactNode; locale: Locale }) {
  const value = useMemo<I18nContextValue>(() => {
    const messages = dictionaries[locale];
    return {
      locale,
      t: (key: MessageKey, params?: TParams) => interpolate(resolveKey(messages, key), params, locale),
    };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function useT(): Translate {
  return useI18n().t;
}

/** Non-hook translator for `lib/actions/*` — plain functions outside React
 *  that still need a translated string (e.g. a toast message). Reads the
 *  locale straight from the settings store's current snapshot rather than
 *  from context, since there's no component tree to read it from. */
export function t(key: MessageKey, params?: TParams): string {
  const locale = useSettingsStore.getState().settings["ui.locale"];
  return interpolate(resolveKey(dictionaries[locale], key), params, locale);
}

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@shared/types/settings";
import { useSettingsStore } from "@renderer/stores/settings.store";
import es from "./messages/es";
import type { Messages } from "./messages/es";

const dictionaries: Partial<Record<Locale, Messages>> = { es };

/** Locales that actually have a dictionary — what the language picker offers.
 *  Dropping in `it.ts`/`en.ts` here (and adding it to `dictionaries` above)
 *  is the whole change needed for a new option to appear. */
export const availableLocales = Object.keys(dictionaries) as Locale[];

/**
 * Every dotted path in the dictionary, as a union.
 *
 * `t()` used to take any `string`: a typo rendered the raw key on screen —
 * "settings.logoDesc" in the middle of a panel — and nothing failed until an
 * operator saw it. With this, a key that does not exist is a compile error.
 *
 * It follows that a key can never be built from a runtime value: the four
 * places that used to interpolate one (`settings.transitionDurationOptions`,
 * `settings.slidesImageFormats` and `library.${kind}s` twice) hold explicit
 * `Record`s at their call sites instead, which is what makes their targets
 * reachable for this type — and for the unused-key sweep.
 */
export type MessageKey = MessagePaths<Messages>;

type MessagePaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessagePaths<T[K]>}`;
}[keyof T & string];

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

export type TParams = Record<string, string | number>;

/** `{name}` placeholders, filled only when params are passed — the ~40
 *  existing call sites that pass none are unaffected. */
function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export type Translate = (key: MessageKey, params?: TParams) => string;

type I18nContextValue = { locale: Locale; t: Translate };
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, locale }: { children: ReactNode; locale: Locale }) {
  const value = useMemo<I18nContextValue>(() => {
    const messages = dictionaries[locale] ?? es;
    return {
      locale,
      t: (key: MessageKey, params?: TParams) => interpolate(resolveKey(messages, key), params),
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
  const messages = dictionaries[locale] ?? es;
  return interpolate(resolveKey(messages, key), params);
}

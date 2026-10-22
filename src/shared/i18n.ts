/**
 * The dictionary mechanics both processes share: the renderer's `useT()`
 * (`renderer/src/lib/i18n/`) and main's `mt()` (`main/i18n/`) each own their
 * dictionaries, but a key is resolved and a `{placeholder}` filled the same way
 * in both.
 */

/**
 * Every dotted path in a dictionary, as a union.
 *
 * `t()` used to take any `string`: a typo rendered the raw key on screen —
 * "settings.logoDesc" in the middle of a panel — and nothing failed until an
 * operator saw it. With this, a key that does not exist is a compile error.
 *
 * It follows that a key can never be built from a runtime value: the places
 * that used to interpolate one hold explicit `Record`s at their call sites
 * instead, which is what makes their targets reachable for this type — and
 * for the unused-key sweep.
 */
export type MessagePaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessagePaths<T[K]>}`;
}[keyof T & string];

export type TParams = Record<string, string | number>;

export function resolveKey(messages: object, key: string): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in node) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

/** `{count, plural, =0 {…} one {# item} other {# items}}`: the ICU shape, cut down
 *  to what a dictionary here needs — exact `=N` forms, the CLDR categories of
 *  `Intl.PluralRules` (Portuguese's `one` covers 0 too, English's does not), and
 *  `#` for the number. No nesting. */
const PLURAL = /\{(\w+), plural,((?:\s*(?:=\d+|\w+) \{[^{}]*\})+)\s*\}/g;
const PLURAL_FORM = /(=\d+|\w+) \{([^{}]*)\}/g;

/** `{name}` placeholders and plurals, filled only when params are passed. */
export function interpolate(template: string, params: TParams | undefined, locale: string): string {
  if (!params) return template;
  return template
    .replace(PLURAL, (match, key: string, body: string) => {
      const value = params[key];
      if (typeof value !== "number") return match;
      const forms = new Map([...body.matchAll(PLURAL_FORM)].map(([, form, text]) => [form!, text!]));
      const text = forms.get(`=${value}`) ?? forms.get(new Intl.PluralRules(locale).select(value)) ?? forms.get("other");
      return text === undefined ? match : text.replaceAll("#", String(value));
    })
    .replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

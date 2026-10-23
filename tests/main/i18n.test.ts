/**
 * The dictionary mechanics both processes share (`shared/i18n.ts`), and main's
 * reading of an OS language tag.
 */
import { describe, expect, test } from "vitest";
import { interpolate } from "../../src/shared/i18n";
import { toLocale } from "../../src/main/i18n";

const items = "{count, plural, one {# item} other {# items}}";

describe("interpolate", () => {
  test("fills placeholders and leaves unknown ones alone", () => {
    expect(interpolate("{name} (copy)", { name: "Easter" }, "en")).toBe("Easter (copy)");
    expect(interpolate("{name} of {total}", { name: "1" }, "en")).toBe("1 of {total}");
  });

  test("picks the plural form by the locale's rules", () => {
    expect(interpolate(items, { count: 1 }, "en")).toBe("1 item");
    expect(interpolate(items, { count: 0 }, "en")).toBe("0 items");
    // Portuguese counts 0 as singular; Spanish and English do not.
    expect(interpolate(items, { count: 0 }, "pt")).toBe("0 item");
    expect(interpolate(`Hay ${items} sin convertir.`, { count: 3 }, "es")).toBe("Hay 3 items sin convertir.");
  });

  test("an exact form wins over the category", () => {
    expect(interpolate("{n, plural, =0 {none} one {# file} other {# files}}", { n: 0 }, "pt")).toBe("none");
  });
});

describe("toLocale", () => {
  test("reduces an OS tag to a supported locale", () => {
    expect(toLocale("pt-BR")).toBe("pt");
    expect(toLocale("en_GB")).toBe("en");
    expect(toLocale("es-419")).toBe("es");
    expect(toLocale("fr-FR")).toBeNull();
    expect(toLocale("")).toBeNull();
  });
});

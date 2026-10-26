/**
 * Which decks a missing LibreOffice stands in front of.
 *
 * A PDF never needs it, and since 2026-10-26 neither does a legacy `.pps`/`.ppt`
 * made of pictures — the whole hymnal, read straight from the file. Which
 * legacy deck still does is only known once main has read it, so for those the
 * gate is decided by main's answer, never up front: refusing them before asking
 * kept the hymnal behind a gate it no longer has.
 */
import { describe, expect, test } from "vitest";
import { sofficeBlocks, type DeckEntry } from "@renderer/stores/deck.store";
import type { DeckEnvironment } from "@shared/types/deck";

const MISSING: DeckEnvironment = { available: false, sofficePath: null, version: null, message: "not found" };
const PRESENT: DeckEnvironment = { available: true, sofficePath: "/usr/bin/soffice", version: "26.8", message: null };

const entry = (status: DeckEntry["status"]): DeckEntry => ({
  status,
  progress: { done: 0, total: 0 },
  deck: null,
  error: status === "failed" ? "LibreOffice not found" : null,
});

describe("with LibreOffice missing", () => {
  test("a .pptx is blocked up front", () => {
    expect(sofficeBlocks(MISSING, "pptx")).toBe(true);
  });

  test("a PDF never is", () => {
    expect(sofficeBlocks(MISSING, "pdf")).toBe(false);
  });

  test("a legacy deck is not blocked before main has tried it, or once it read it", () => {
    expect(sofficeBlocks(MISSING, "pps")).toBe(false);
    expect(sofficeBlocks(MISSING, ".PPT")).toBe(false);
    expect(sofficeBlocks(MISSING, "pps", entry("converting"))).toBe(false);
    expect(sofficeBlocks(MISSING, "pps", entry("ready"))).toBe(false);
  });

  test("a legacy deck main could not read without it is blocked", () => {
    expect(sofficeBlocks(MISSING, "pps", entry("failed"))).toBe(true);
  });
});

test("with LibreOffice present, or not asked for yet, nothing is blocked", () => {
  for (const environment of [PRESENT, null]) {
    expect(sofficeBlocks(environment, "pptx")).toBe(false);
    expect(sofficeBlocks(environment, "pps", entry("failed"))).toBe(false);
  }
});

/**
 * `live-intent.ts` — the rule that the last thing the operator did wins.
 *
 * Almost every path to the projector is synchronous; `goLiveWithDeck` is not,
 * because it awaits a conversion that can take seconds. The operator is not
 * frozen while it runs — they press BLACK, or send something else live — and
 * the conversion used to finish and commit anyway, lifting the overlay they
 * had just put up and projecting a deck they had already abandoned, mid
 * service.
 */
import { describe, expect, test } from "vitest";
import { claimLiveIntent, isCurrentLiveIntent } from "@renderer/lib/actions/live-intent";

describe("claimLiveIntent", () => {
  test("a fresh claim is the current one", () => {
    const intent = claimLiveIntent();
    expect(isCurrentLiveIntent(intent)).toBe(true);
  });

  test("a later claim supersedes an earlier one", () => {
    const first = claimLiveIntent();
    const second = claimLiveIntent();

    expect(isCurrentLiveIntent(first)).toBe(false);
    expect(isCurrentLiveIntent(second)).toBe(true);
  });

  test("every claim is distinct, so two in the same tick cannot be confused", () => {
    const claims = [claimLiveIntent(), claimLiveIntent(), claimLiveIntent()];
    expect(new Set(claims).size).toBe(3);
  });

  test("the counter never goes backwards: an old claim stays superseded", () => {
    // A slow conversion that resolves long after the operator moved on must
    // stay dropped, however many other things happened in between.
    const abandoned = claimLiveIntent();
    for (let i = 0; i < 5; i += 1) claimLiveIntent();
    expect(isCurrentLiveIntent(abandoned)).toBe(false);
  });

  test("a value nobody ever claimed is not current", () => {
    claimLiveIntent();
    expect(isCurrentLiveIntent(-1)).toBe(false);
    expect(isCurrentLiveIntent(Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

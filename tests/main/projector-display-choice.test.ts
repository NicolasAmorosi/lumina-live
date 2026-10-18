import { expect, test } from "vitest";
import { chooseProjectorDisplay } from "../../src/main/windows/projector-display-choice";

test("the operator's chosen screen wins while it is connected", () => {
  expect(chooseProjectorDisplay([1, 2, 3], 1, 3)).toBe(3);
});

test("otherwise the first screen that is not the operator's own", () => {
  expect(chooseProjectorDisplay([1, 2, 3], 1, 9)).toBe(2);
  expect(chooseProjectorDisplay([1, 2], 1, null)).toBe(2);
});

test("never the primary screen, even when it is the one chosen", () => {
  expect(chooseProjectorDisplay([1], 1, 1)).toBeNull();
  expect(chooseProjectorDisplay([1, 2], 1, 1)).toBe(2);
});

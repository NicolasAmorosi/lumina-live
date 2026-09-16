import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useToastStore } from "@renderer/stores/toast.store";

/** Must match `EXIT_MS` in the store, which is module-private: a test that
 *  imported it could not tell a changed duration from a broken exit. */
const EXIT_MS = 180;

function toasts() {
  return useToastStore.getState().toasts;
}

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** The exit animation is the only reason a dismissed toast outlives its
 *  `dismiss()` call, so every case here is about that window: what it looks
 *  like while it lasts, and what must not happen inside it. */
describe("toast store exit animation", () => {
  test("a dismissed toast stays, marked exiting, until the animation ends", () => {
    const id = useToastStore.getState().push({ tone: "info", message: "hola" });

    useToastStore.getState().dismiss(id);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.exiting).toBe(true);

    vi.advanceTimersByTime(EXIT_MS);
    expect(toasts()).toHaveLength(0);
  });

  test("auto-dismiss goes through the same exit, not a straight removal", () => {
    useToastStore.getState().push({ tone: "info", message: "hola", durationMs: 1000 });

    vi.advanceTimersByTime(1000);
    expect(toasts()[0]?.exiting).toBe(true);

    vi.advanceTimersByTime(EXIT_MS);
    expect(toasts()).toHaveLength(0);
  });

  test("dismissing twice does not restart the exit or remove a later toast", () => {
    const id = useToastStore.getState().push({ tone: "info", message: "hola" });
    useToastStore.getState().dismiss(id);

    vi.advanceTimersByTime(EXIT_MS - 20);
    useToastStore.getState().dismiss(id);
    vi.advanceTimersByTime(20);

    expect(toasts()).toHaveLength(0);
  });

  test("eviction by the cap is immediate — the room is needed now", () => {
    for (let i = 0; i < 5; i++) {
      useToastStore.getState().push({ tone: "info", message: `t${i}`, durationMs: null });
    }

    // Four, not five with one fading: an animated eviction would hold the
    // height of the toast being retired for as long as the new one needs it.
    expect(toasts()).toHaveLength(4);
    expect(toasts().map((t) => t.message)).toEqual(["t1", "t2", "t3", "t4"]);
  });

  test("an exiting toast that gets evicted leaves no timer behind", () => {
    const id = useToastStore.getState().push({ tone: "info", message: "old", durationMs: null });
    useToastStore.getState().dismiss(id);
    for (let i = 0; i < 4; i++) {
      useToastStore.getState().push({ tone: "info", message: `t${i}`, durationMs: null });
    }
    expect(toasts().some((t) => t.id === id)).toBe(false);

    // The evicted toast's exit timer must not fire into a store that has
    // moved on: it would be a no-op filter here, but a pending timer is what
    // the cap's own `cancelTimer` exists to prevent.
    expect(vi.getTimerCount()).toBe(0);
  });
});

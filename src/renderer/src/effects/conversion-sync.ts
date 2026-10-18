import { api } from "@renderer/lib/api";
import { onIpc } from "@renderer/lib/ipc";
import { useConversionStore } from "@renderer/stores/conversion.store";
import type { DecoderSupport } from "@shared/types/media";

/**
 * What only this renderer's Chromium can say: whether the GPU decodes HEVC.
 * `isTypeSupported` answers for the platform decoder, which is the only HEVC
 * decoder Chromium has — no software fallback — so on a PC without one an
 * iPhone video would play as silence over black. Main converts those.
 */
function decoderSupport(): DecoderSupport {
  const supports = (codecs: string) => {
    try {
      return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(`video/mp4; codecs="${codecs}"`);
    } catch {
      return false;
    }
  };
  return { hevc: supports("hvc1.1.6.L93.B0"), hevcMain10: supports("hvc1.2.4.L153.B0") };
}

/**
 * Mirrors main's conversions into `conversion.store`, and is what starts them:
 * main decides nothing until it hears what this machine decodes.
 *
 * Subscribed before the list is fetched. Events and invoke replies travel the
 * same ordered pipe, so an event that arrives before the reply describes an
 * older state the reply supersedes, and every one after it is newer.
 */
export function startConversionSync(): () => void {
  const unsubscribe = onIpc("conversion-changed", (update) => useConversionStore.getState().apply(update));
  void (async () => {
    try {
      await api.conversion.reportDecoders(decoderSupport());
      useConversionStore.getState().reset(await api.conversion.list());
    } catch (error) {
      console.warn("[convert] sync failed", error);
    }
  })();
  return unsubscribe;
}

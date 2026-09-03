import type { WorshipBridge } from "./index";

declare global {
  interface Window {
    worship: WorshipBridge;
  }
}

export type Theme = "dark" | "light";
export type Locale = "es" | "it" | "en";

export type SettingsMap = {
  "logo.path": string | null;
  "files.lastFolder": string | null;
  "projection.displayId": number | null;
  "ui.theme": Theme;
  "ui.locale": Locale;
  "media.volume": number;
};

export const DEFAULT_SETTINGS: SettingsMap = {
  "logo.path": null,
  "files.lastFolder": null,
  "projection.displayId": null,
  "ui.theme": "dark",
  "ui.locale": "es",
  "media.volume": 0.5,
};

import { readJson, STORAGE_KEYS, writeJson } from "./storage";

/**
 * "system" is the default and means "whatever the OS is doing right now",
 * which is why it is a value in its own right rather than an absence: picking
 * it back explicitly has to undo an earlier choice.
 */
export type Theme = "system" | "light" | "dark";

/** What a theme actually renders as at this moment. */
export type ResolvedTheme = "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

export const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

export const loadTheme = (): Theme => {
  const stored = readJson<unknown>(STORAGE_KEYS.theme, undefined);
  return isTheme(stored) ? stored : "system";
};

export const saveTheme = (theme: Theme) => {
  writeJson(STORAGE_KEYS.theme, theme);
};

/** What the next click should select, cycling through all three. */
export const nextTheme = (theme: Theme): Theme =>
  theme === "system" ? "light" : theme === "light" ? "dark" : "system";

export const themeLabel = (theme: Theme): string =>
  theme === "system" ? "System theme" : theme === "light" ? "Light theme" : "Dark theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Whether the OS is currently asking for a dark interface. */
export const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(DARK_QUERY).matches;

/**
 * Subscribes to the OS preference. Shaped for `useSyncExternalStore`, which is
 * how a component reads a value that lives outside React and can change on its
 * own — the alternative being a state that an effect has to keep chasing.
 */
export const subscribeSystemTheme = (onChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

export const resolveTheme = (theme: Theme, systemIsDark = systemPrefersDark()) =>
  (theme === "system" ? (systemIsDark ? "dark" : "light") : theme) as ResolvedTheme;

/**
 * Puts the choice on <html>, where the stylesheet reads it. "system" removes
 * the attribute rather than writing a value, so `color-scheme: light dark` is
 * left to follow the OS on its own.
 */
export const applyTheme = (theme: Theme) => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }

  syncThemeColor();
};

/**
 * Keeps <meta name="theme-color"> — the colour browsers paint their own chrome
 * with — in step. It reads the resolved background rather than a copy of the
 * palette, so it cannot drift from the stylesheet.
 */
export const syncThemeColor = () => {
  if (typeof document === "undefined" || !document.body) {
    return;
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", getComputedStyle(document.body).backgroundColor);
  }
};

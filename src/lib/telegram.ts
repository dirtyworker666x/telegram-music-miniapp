export type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  initData?: string;
  initDataUnsafe?: {
    user?: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string };
  };
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
};

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { Telegram?: { WebApp?: TelegramWebApp } };
  return w.Telegram?.WebApp ?? null;
}

/** initData строка для отправки на бэкенд */
export function getInitData(): string {
  return getWebApp()?.initData ?? "";
}

/** Данные текущего пользователя (без верификации, только для UI) */
export function getTelegramUser() {
  return getWebApp()?.initDataUnsafe?.user ?? null;
}

export const applyTelegramTheme = () => {
  const WebApp = getWebApp();
  if (!WebApp) {
    document.documentElement.classList.remove("dark");
    return;
  }
  const scheme = WebApp.colorScheme ?? "light";
  const isDark = scheme === "dark";
  document.documentElement.classList.toggle("dark", isDark);

  const params = WebApp.themeParams ?? {};
  const root = document.documentElement;

  const setVar = (name: string, value?: string) => {
    if (!value) return;
    root.style.setProperty(name, value);
  };

  setVar("--tg-bg", params.bg_color);
  setVar("--tg-text", params.text_color);
  setVar("--tg-hint", params.hint_color);
  setVar("--tg-accent", params.button_color);
  setVar("--tg-accent-text", params.button_text_color);
};

export const initTelegram = () => {
  const WebApp = getWebApp();
  if (!WebApp) return;
  try {
    WebApp.ready();
    WebApp.expand();
    applyTelegramTheme();
    WebApp.onEvent("themeChanged", applyTelegramTheme);
  } catch {
    // Safe fallback for non-Telegram environment.
  }
};

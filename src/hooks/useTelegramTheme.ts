import { useEffect, useState } from "react";
import { applyTelegramTheme } from "../lib/telegram";

function getWebApp() {
  if (typeof window === "undefined") return null;
  const w = window as Window & { Telegram?: { WebApp?: { colorScheme?: string; onEvent: (e: string, h: () => void) => void; offEvent: (e: string, h: () => void) => void } } };
  return w.Telegram?.WebApp ?? null;
}

export const useTelegramTheme = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const WebApp = getWebApp();
    const update = () => {
      const scheme = WebApp?.colorScheme ?? "light";
      setIsDark(scheme === "dark");
      applyTelegramTheme();
    };

    update();

    if (WebApp) {
      try {
        WebApp.onEvent("themeChanged", update);
        return () => WebApp.offEvent("themeChanged", update);
      } catch {
        return;
      }
    }
  }, []);

  return { isDark };
};

import { useEffect } from "react";

/**
 * Подключает audio.src и сразу вызывает play() — браузер
 * регистрирует "intent to play" и показывает Pause в системном пуше
 * даже во время буферизации. Без play() браузер показывает Play.
 */
export const useHlsAudio = (
  audioRef: React.RefObject<HTMLAudioElement>,
  url: string | null,
  onReady: () => void,
  onError: (msg: string) => void
) => {
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    let cancelled = false;

    // Устанавливаем src и СРАЗУ вызываем play().
    // play() вернёт rejected promise (нет данных), но браузер
    // запоминает intent to play и показывает Pause в пуше.
    // Когда данные придут — canplay → play() сработает.
    audio.src = url;

    // Сразу play() — ключ к правильной иконке в пуше
    audio.play().catch(() => {
      // Ожидаемый reject — данные ещё не загружены.
      // Не делаем ничего — canplay обработает ниже.
    });

    const handleCanPlay = () => {
      if (cancelled) return;
      // Если после буферизации audio на паузе — запускаем
      if (audio.paused) {
        audio.play()
          .then(() => { if (!cancelled) onReady(); })
          .catch(() => { if (!cancelled) onError("Не удалось воспроизвести"); });
      } else {
        onReady();
      }
    };

    const handleError = () => {
      if (!cancelled) onError("Ошибка загрузки аудио");
    };

    audio.addEventListener("canplay", handleCanPlay, { once: true });
    audio.addEventListener("error", handleError, { once: true });

    return () => {
      cancelled = true;
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
    };
  }, [audioRef, url, onReady, onError]);
};

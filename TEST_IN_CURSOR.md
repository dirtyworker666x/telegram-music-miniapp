# Как протестировать Mini App прямо в Cursor

## 1. Установка и запуск

В терминале Cursor (**Terminal → New Terminal** или `` Ctrl+` ``):

```bash
npm install
npm run dev
```

Дождись сообщения вида:
```
  ➜  Local:   http://localhost:5173/
```

## 2. Открыть в Cursor (встроенный браузер)

**Вариант A — Simple Browser (удобно внутри IDE):**

1. **Command Palette**: `Cmd+Shift+P` (macOS) или `Ctrl+Shift+P` (Windows/Linux).
2. Набери: **Simple Browser: Show**.
3. Введи URL: `http://localhost:5173`.
4. Enter — приложение откроется во вкладке внутри Cursor.

**Вариант B — по ссылке из терминала:**

- В выводе `npm run dev` часто можно **кликнуть** по `http://localhost:5173` — откроется в браузере по умолчанию.

**Вариант C — обычный браузер:**

- Открой в Chrome/Safari: `http://localhost:5173`.

## 3. Что проверить

- Поисковая строка сверху.
- Ввод запроса (поиск пойдёт на backend `http://localhost:3000` — если его нет, будет ошибка, это нормально).
- Блок «Мой плейлист» (пока пустой).
- Тема: в Cursor/системе тёмная — в приложении будет тёмная, т.к. вне Telegram тема по умолчанию.

Чтобы проверить поиск и воспроизведение, нужен запущенный backend на `http://localhost:3000` (или другой URL в `.env.local` как `VITE_API_BASE`).

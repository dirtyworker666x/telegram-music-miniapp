/**
 * Генерация карточки для Telegram Stories — только в браузере, без отправки на сервер.
 * Рисует обложку трека, название, исполнителя и логотип TGPlay.
 */

const STORY_W = 1080;
const STORY_H = 1920;

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export type StoryTrack = {
  title: string;
  artist: string;
  artwork?: string | null;
};

/**
 * Рисует карточку для сторис на canvas. Возвращает canvas с изображением.
 */
export async function drawStoryCard(
  track: StoryTrack,
  logoUrl: string
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d not available");

  // Фон — градиент (как в плеере)
  const bg = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
  bg.addColorStop(0, "#0a1628");
  bg.addColorStop(0.5, "#0d2137");
  bg.addColorStop(1, "#0088cc");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // Обложка трека по центру (или прямоугольник, если не загрузилась)
  const coverSize = 720;
  const coverX = (STORY_W - coverSize) / 2;
  const coverY = 380;
  const coverR = 48;

  let coverLoaded = false;
  if (track.artwork) {
    try {
      const coverImg = await loadImage(track.artwork, true);
      ctx.save();
      drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverR);
      ctx.clip();
      ctx.drawImage(coverImg, coverX, coverY, coverSize, coverSize);
      ctx.restore();
      coverLoaded = true;
    } catch {
      // CORS или ошибка загрузки — рисуем placeholder
    }
  }
  if (!coverLoaded) {
    ctx.fillStyle = "rgba(0, 136, 204, 0.5)";
    drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverR);
    ctx.fill();
  }

  // Название и исполнитель
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  const titleY = coverY + coverSize + 80;
  const maxTitleW = STORY_W - 80;
  let title = track.title;
  if (ctx.measureText(title).width > maxTitleW) {
    while (title.length > 0 && ctx.measureText(title + "…").width > maxTitleW) title = title.slice(0, -1);
    title = title + "…";
  }
  ctx.fillText(title, STORY_W / 2, titleY);

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "42px system-ui, -apple-system, sans-serif";
  let artist = track.artist;
  if (ctx.measureText(artist).width > maxTitleW) {
    while (artist.length > 0 && ctx.measureText(artist + "…").width > maxTitleW) artist = artist.slice(0, -1);
    artist = artist + "…";
  }
  ctx.fillText(artist, STORY_W / 2, titleY + 64);

  // Логотип TGPlay — выше от низа, крупнее
  try {
    const logoImg = await loadImage(logoUrl, false);
    const logoSize = 180;
    const logoX = (STORY_W - logoSize) / 2;
    const logoY = STORY_H - 380;
    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "42px system-ui, sans-serif";
    ctx.fillText("TGPlay", STORY_W / 2, logoY + logoSize + 52);
  } catch {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "42px system-ui, sans-serif";
    ctx.fillText("TGPlay", STORY_W / 2, STORY_H - 320);
  }

  return canvas;
}

/**
 * Генерирует карточку и отдаёт как File для шаринга или скачивания.
 */
export async function getStoryCardFile(
  track: StoryTrack,
  logoUrl: string,
  filename = "tgplay-story.png"
): Promise<File> {
  const canvas = await drawStoryCard(track, logoUrl);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob failed"));
          return;
        }
        resolve(new File([blob], filename, { type: "image/png" }));
      },
      "image/png",
      0.82
    );
  });
}

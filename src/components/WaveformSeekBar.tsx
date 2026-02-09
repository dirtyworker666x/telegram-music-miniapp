import { useCallback, useEffect, useRef, useState, memo } from "react";

/**
 * SoundCloud-style waveform seek bar.
 *
 * Generates a deterministic waveform from the track ID (instant, no network cost)
 * and draws it on a <canvas> with played/unplayed bar coloring.
 * Supports touch + mouse dragging for seeking.
 */

type WaveformSeekBarProps = {
  trackId: string;
  currentTime: number;
  duration: number;
  onSeekStart: () => void;
  onSeekMove: (time: number) => void;
  onSeekEnd: (time: number) => void;
};

const BAR_COUNT = 80;
const BAR_WIDTH = 2.5;
const BAR_GAP = 1.5;
const BAR_MIN = 0.08;
const BAR_MAX = 1.0;
const CANVAS_HEIGHT = 48;
const PLAYED_COLOR = "rgba(0, 136, 204, 1)";
const PLAYED_COLOR_TOP = "rgba(84, 169, 235, 0.9)";
const UNPLAYED_COLOR = "rgba(255, 255, 255, 0.25)";
const UNPLAYED_COLOR_TOP = "rgba(255, 255, 255, 0.15)";
const CURSOR_COLOR = "rgba(255, 255, 255, 0.9)";

// ─── Deterministic waveform generation ────────────────────────

function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/** Seeded pseudo-random (mulberry32) */
function seededRandom(seed: number) {
  let t = seed + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function generateWaveformData(trackId: string): Float32Array {
  const data = new Float32Array(BAR_COUNT);
  const seed = hashCode(trackId);

  // Generate raw values
  for (let i = 0; i < BAR_COUNT; i++) {
    data[i] = seededRandom(seed + i * 7 + 13);
  }

  // Apply envelope: louder in the middle, quieter at edges (like real music)
  for (let i = 0; i < BAR_COUNT; i++) {
    const position = i / BAR_COUNT;
    // Smooth rise in first 10%, sustain in middle, slight fall at end
    let envelope = 1.0;
    if (position < 0.08) envelope = 0.3 + 0.7 * (position / 0.08);
    else if (position > 0.92) envelope = 0.4 + 0.6 * ((1 - position) / 0.08);
    data[i] *= envelope;
  }

  // Smooth with neighbors (moving average window = 3)
  const smoothed = new Float32Array(BAR_COUNT);
  for (let i = 0; i < BAR_COUNT; i++) {
    const prev = i > 0 ? data[i - 1] : data[i];
    const next = i < BAR_COUNT - 1 ? data[i + 1] : data[i];
    smoothed[i] = prev * 0.2 + data[i] * 0.6 + next * 0.2;
  }

  // Normalize to [BAR_MIN, BAR_MAX]
  let max = 0;
  for (let i = 0; i < BAR_COUNT; i++) if (smoothed[i] > max) max = smoothed[i];
  if (max === 0) max = 1;
  for (let i = 0; i < BAR_COUNT; i++) {
    smoothed[i] = BAR_MIN + (smoothed[i] / max) * (BAR_MAX - BAR_MIN);
  }

  return smoothed;
}

// ─── Waveform cache (per trackId) ─────────────────────────────
const _waveformCache = new Map<string, Float32Array>();

function getWaveform(trackId: string): Float32Array {
  let wf = _waveformCache.get(trackId);
  if (!wf) {
    wf = generateWaveformData(trackId);
    _waveformCache.set(trackId, wf);
    // Keep cache small
    if (_waveformCache.size > 30) {
      const first = _waveformCache.keys().next().value;
      if (first) _waveformCache.delete(first);
    }
  }
  return wf;
}

// ─── Drawing ──────────────────────────────────────────────────

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: Float32Array,
  progress: number, // 0..1
  width: number,
  height: number,
  dpr: number,
) {
  ctx.clearRect(0, 0, width * dpr, height * dpr);

  const totalBarWidth = BAR_WIDTH + BAR_GAP;
  const startX = (width * dpr - BAR_COUNT * totalBarWidth * dpr) / 2;
  const progressX = startX + progress * BAR_COUNT * totalBarWidth * dpr;

  for (let i = 0; i < BAR_COUNT; i++) {
    const amp = waveform[i];
    const barH = Math.max(2 * dpr, amp * (height - 4) * dpr);
    const x = startX + i * totalBarWidth * dpr;
    const y = (height * dpr - barH) / 2;
    const w = BAR_WIDTH * dpr;
    const r = Math.min(w / 2, 2 * dpr);

    const isPlayed = x + w <= progressX;
    const isPartial = x < progressX && x + w > progressX;

    if (isPlayed) {
      // Gradient for played bars
      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, PLAYED_COLOR_TOP);
      grad.addColorStop(1, PLAYED_COLOR);
      ctx.fillStyle = grad;
      roundedRect(ctx, x, y, w, barH, r);
      ctx.fill();
    } else if (isPartial) {
      // Split bar: played part + unplayed part
      const playedW = progressX - x;
      // Played portion
      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, PLAYED_COLOR_TOP);
      grad.addColorStop(1, PLAYED_COLOR);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, playedW, barH);
      // Unplayed portion
      const grad2 = ctx.createLinearGradient(x, y, x, y + barH);
      grad2.addColorStop(0, UNPLAYED_COLOR_TOP);
      grad2.addColorStop(1, UNPLAYED_COLOR);
      ctx.fillStyle = grad2;
      ctx.fillRect(progressX, y, w - playedW, barH);
    } else {
      // Unplayed
      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, UNPLAYED_COLOR_TOP);
      grad.addColorStop(1, UNPLAYED_COLOR);
      ctx.fillStyle = grad;
      roundedRect(ctx, x, y, w, barH, r);
      ctx.fill();
    }
  }

  // Cursor line
  if (progress > 0 && progress < 1) {
    ctx.fillStyle = CURSOR_COLOR;
    const cursorX = progressX - dpr;
    ctx.fillRect(cursorX, 2 * dpr, 2 * dpr, (height - 4) * dpr);
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
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

// ─── Component ────────────────────────────────────────────────

export const WaveformSeekBar = memo(({
  trackId,
  currentTime,
  duration,
  onSeekStart,
  onSeekMove,
  onSeekEnd,
}: WaveformSeekBarProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const waveformRef = useRef<Float32Array>(getWaveform(trackId));
  const rafRef = useRef<number>(0);

  // Update waveform when track changes
  useEffect(() => {
    waveformRef.current = getWaveform(trackId);
    setLocalProgress(null);
  }, [trackId]);

  // Draw on every frame
  const progress = localProgress ?? (duration > 0 ? currentTime / duration : 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = CANVAS_HEIGHT;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    drawWaveform(ctx, waveformRef.current, Math.min(Math.max(progress, 0), 1), w, h, dpr);
  }, [progress, trackId]);

  // ─── Touch / Mouse handlers ──────────────────────────────

  const getProgressFromEvent = useCallback((clientX: number): number => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();

    // Calculate bar area bounds
    const totalBarWidth = BAR_WIDTH + BAR_GAP;
    const barsWidth = BAR_COUNT * totalBarWidth;
    const startX = (rect.width - barsWidth) / 2;

    const x = clientX - rect.left - startX;
    return Math.min(Math.max(x / barsWidth, 0), 1);
  }, []);

  const handleStart = useCallback((clientX: number) => {
    draggingRef.current = true;
    onSeekStart();
    const p = getProgressFromEvent(clientX);
    setLocalProgress(p);
    if (duration > 0) onSeekMove(p * duration);
  }, [getProgressFromEvent, onSeekStart, onSeekMove, duration]);

  const handleMove = useCallback((clientX: number) => {
    if (!draggingRef.current) return;
    const p = getProgressFromEvent(clientX);
    setLocalProgress(p);
    if (duration > 0) onSeekMove(p * duration);
  }, [getProgressFromEvent, onSeekMove, duration]);

  const handleEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (localProgress !== null && duration > 0) {
      onSeekEnd(localProgress * duration);
    }
    setLocalProgress(null);
  }, [localProgress, duration, onSeekEnd]);

  // Touch events
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleStart(e.touches[0].clientX);
  }, [handleStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleMove(e.touches[0].clientX);
  }, [handleMove]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleEnd();
  }, [handleEnd]);

  // Mouse events
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    handleStart(e.clientX);
  }, [handleStart]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => handleEnd();

    if (draggingRef.current) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  });

  // Cleanup RAF
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full relative cursor-pointer select-none"
      style={{ height: CANVAS_HEIGHT, touchAction: "none" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ width: "100%", height: CANVAS_HEIGHT }}
      />
    </div>
  );
});

WaveformSeekBar.displayName = "WaveformSeekBar";

import { useEffect, useRef, useState } from 'react';
import type { Replay, ReplayAction } from '../../../../packages/contracts/src/replay';
import crownUrl from './assets/crownie.png';
import cityUrl from './assets/citie.png';
import mountainUrl from './assets/mountainie.png';
import { playerColors } from './model';

const CELL = 40; // Drawing coordinates; icons and text scale together with the board.
const DEFAULT_TILE_PX = 32;

export function ReplayBoard({
  replay,
  cells,
  frame,
  actions,
  zoom,
}: {
  replay: Replay;
  cells: readonly number[];
  frame: number;
  actions: readonly ReplayAction[];
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<{ width: number; height: number } | null>(null);
  const [images, setImages] = useState<HTMLImageElement[]>([]);

  useEffect(() => {
    let disposed = false;
    void Promise.all(
      [crownUrl, cityUrl, mountainUrl].map(
        (url) =>
          new Promise<HTMLImageElement>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => resolve(image);
            image.src = url;
          }),
      ),
    ).then((loaded) => {
      if (!disposed) setImages(loaded);
      // Canvas text is not repainted automatically when a web font becomes ready.
      void document.fonts?.load('600 15px Quicksand').then(() => {
        if (!disposed) setImages([...loaded]);
      });
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const scale =
    (available
      ? Math.min(available.width / (replay.width * CELL), available.height / (replay.height * CELL))
      : DEFAULT_TILE_PX / CELL) * zoom;
  const width = replay.width * CELL * scale;
  const height = replay.height * CELL * scale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio * scale, ratio * scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let index = 0; index < replay.width * replay.height; index++) {
      const type = cells[index * 3]!;
      const owner = cells[index * 3 + 1]!;
      const army = cells[index * 3 + 2]!;
      const x = (index % replay.width) * CELL;
      const y = Math.floor(index / replay.width) * CELL;
      ctx.fillStyle =
        type === 0 || type === 5
          ? '#46494c'
          : owner >= 0
            ? playerColors[owner % playerColors.length]!
            : type === 2
              ? '#bbbbbb'
              : type === 3
                ? '#808080'
                : '#e6e6e6';
      ctx.fillRect(x, y, CELL, CELL);
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      const image = images[type === 4 ? 0 : type === 3 ? 1 : 2];
      if ([2, 3, 4].includes(type) && image?.naturalWidth) {
        const iconSize = 36;
        ctx.drawImage(
          image,
          x + (CELL - iconSize) / 2,
          y + (CELL - iconSize) / 2,
          iconSize,
          iconSize,
        );
      }
      if (type === 5 && images[2]?.naturalWidth) {
        // Fogged mountains and cities are intentionally indistinguishable.
        ctx.globalAlpha = 110 / 255;
        ctx.drawImage(images[2], x + 4, y + 4, 32, 32);
        ctx.globalAlpha = 1;
      }
      if (army > 0 && type !== 0 && type !== 5) {
        const text = String(army);
        ctx.font = `600 ${text.length > 4 ? 11 : 13}px Quicksand, sans-serif`;
        // Keep all army counts centered and light, including neutral cities.
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 2 * ratio * scale;
        ctx.shadowOffsetX = ratio * scale;
        ctx.shadowOffsetY = ratio * scale;
        ctx.fillText(text, x + CELL / 2, y + CELL / 2);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
    }
    // Paint oldest first: the current operation stays legible over its faded history.
    for (const action of actions) {
      const sx = ((action.from % replay.width) + 0.5) * CELL;
      const sy = (Math.floor(action.from / replay.width) + 0.5) * CELL;
      const tx = ((action.to % replay.width) + 0.5) * CELL;
      const ty = (Math.floor(action.to / replay.width) + 0.5) * CELL;
      const dx = tx - sx;
      const dy = ty - sy;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const ux = dx / length;
      const uy = dy / length;
      const endX = tx - ux * 7;
      const endY = ty - uy * 7;
      ctx.globalAlpha = Math.max(0.12, 1 - (frame - action.frame) / 13);
      ctx.strokeStyle = action.status === 'sent' ? '#ffef64' : '#f8fafc';
      ctx.lineWidth = action.frame === frame ? 4 : 2.5;
      ctx.lineCap = 'round';
      ctx.setLineDash(action.split || action.status !== 'sent' ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(sx + ux * 7, sy + uy * 7);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(endX - ux * 8 - uy * 5, endY - uy * 8 + ux * 5);
      ctx.lineTo(endX, endY);
      ctx.lineTo(endX - ux * 8 + uy * 5, endY - uy * 8 - ux * 5);
      ctx.stroke();
      if (action.split) {
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#ffef64';
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 3;
        ctx.strokeText('½', sx - uy * 11, sy + ux * 11);
        ctx.fillText('½', sx - uy * 11, sy + ux * 11);
      }
    }
    ctx.globalAlpha = 1;
  }, [replay, cells, frame, actions, scale, width, height, images]);

  return (
    <div ref={containerRef} className="replay-board-viewport">
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        tabIndex={0}
        role="img"
        aria-label={`${replay.width} × ${replay.height} 棋盘，回合 ${replay.frames[frame]!.turn}，使用播放控制或左右方向键逐帧观察`}
      />
    </div>
  );
}

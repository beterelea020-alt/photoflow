export interface StatementRow { label: string; value: string; tone?: 'plus' | 'minus' }
export interface StatementSpec { studio: string; title: string; subtitle?: string; rows: StatementRow[]; totals: StatementRow[]; footer?: string }

const FONT = '"Noto Sans Arabic Variable", "Noto Sans Arabic", Tahoma, sans-serif';
const COLORS = { bg: '#fbf8f4', band: '#3b2418', cream: '#f5ebdd', gold: '#d9b27a', ink: '#2b1d14', muted: '#8a7868', line: '#e8dccd', plus: '#4f7a5c', minus: '#b0503e' };

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** Draws a clean, shareable statement (receipt / summary) as a PNG. */
export async function renderStatement(spec: StatementSpec): Promise<Blob> {
  await Promise.all([document.fonts.load(`700 34px ${FONT}`), document.fonts.load(`400 26px ${FONT}`)]).catch(() => undefined);
  const W = 900, pad = 56, rowH = 68, headerH = 230, totalRowH = 78;
  const H = headerH + 24 + spec.rows.length * rowH + 28 + spec.totals.length * totalRowH + 40 + (spec.footer ? 96 : 40);
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.scale(scale, scale);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COLORS.band; ctx.fillRect(0, 0, W, headerH);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.gold; ctx.font = `600 26px ${FONT}`;
  ctx.fillText(fit(ctx, spec.title, W - pad * 2), W - pad, 62);
  ctx.fillStyle = COLORS.cream; ctx.font = `700 44px ${FONT}`;
  ctx.fillText(fit(ctx, spec.studio || 'PhotoFlow', W - pad * 2), W - pad, 124);
  if (spec.subtitle) { ctx.fillStyle = COLORS.cream; ctx.globalAlpha = 0.85; ctx.font = `400 25px ${FONT}`; ctx.fillText(fit(ctx, spec.subtitle, W - pad * 2), W - pad, 184); ctx.globalAlpha = 1; }

  let y = headerH + 24;
  const drawRow = (row: StatementRow, height: number, bold: boolean, size: number, line: boolean) => {
    const cy = y + height / 2;
    ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}`;
    ctx.fillStyle = bold ? COLORS.ink : COLORS.muted;
    ctx.textAlign = 'right';
    const valueWidth = ctx.measureText(row.value).width;
    ctx.fillText(fit(ctx, row.label, W - pad * 2 - valueWidth - 24), W - pad, cy);
    ctx.fillStyle = row.tone === 'plus' ? COLORS.plus : row.tone === 'minus' ? COLORS.minus : COLORS.ink;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(row.value, pad, cy);
    if (line) { ctx.strokeStyle = COLORS.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, y + height); ctx.lineTo(W - pad, y + height); ctx.stroke(); }
    y += height;
  };
  spec.rows.forEach((row) => drawRow(row, rowH, false, 27, true));
  y += 28;
  ctx.fillStyle = COLORS.cream; ctx.fillRect(pad - 20, y - 8, W - pad * 2 + 40, spec.totals.length * totalRowH + 16);
  spec.totals.forEach((row, index) => drawRow(row, totalRowH, true, 31, index < spec.totals.length - 1));
  if (spec.footer) { ctx.textAlign = 'center'; ctx.fillStyle = COLORS.muted; ctx.font = `400 24px ${FONT}`; ctx.fillText(fit(ctx, spec.footer, W - pad * 2), W / 2, H - 54); }

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png failed'))), 'image/png'));
}

/** Opens the phone's share sheet with the image; falls back to a normal download. */
export async function shareImage(blob: Blob, filename: string, text?: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return 'downloaded';
}

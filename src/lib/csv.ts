type Cell = string | number | undefined | null;

const safe = (value: Cell) => {
  const text = String(value ?? '');
  // Stop spreadsheet apps from treating text as a formula.
  return /^[=@]|^[+-][^\d\s]/.test(text) ? `'${text}` : text;
};

/** UTF-8 with BOM so Excel shows Arabic correctly. */
export function downloadCsv(filename: string, rows: Cell[][]) {
  const body = rows.map((row) => row.map((cell) => `"${safe(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

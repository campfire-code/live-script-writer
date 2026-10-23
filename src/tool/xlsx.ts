// Excel 写出：基于 exceljs（MIT）。写出时加粗表头、冻结首行、按内容估算列宽，
// 支持把指定单元格标红、指定列自动换行。
import ExcelJS from 'exceljs';
import type { Cell } from './common';

/** 工作表名：Excel 限 31 个字符，不能含 []:*?/\，同一工作簿内不能重名 */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const base = (n.replace(/[[\]:*?/\\]/g, '_').trim() || 'Sheet').slice(0, 31);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)}_${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

const width = (v: Cell) => (v == null ? 0 : v instanceof Date ? 18 : Math.max(...String(v).split('\n').map((line) => [...line].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0))));

export interface OutSheet {
  name: string;
  header: string[];
  rows: Cell[][];
  /** 要标红的单元格：「行号,列号」（从 0 开始，不含表头） */
  red?: Set<string>;
  /** 自动换行的列（从 0 开始） */
  wrap?: number[];
  /** 不冻结首行、不加粗表头（用于自由排版的汇总页） */
  plain?: boolean;
  /** 要加粗的行（从 0 开始，不含表头），用于汇总页的小标题 */
  boldRows?: number[];
}

export async function writeXlsx(sheets: OutSheet[], creator = '篝火'): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  const names = sheetNames(sheets.map((s) => s.name));
  sheets.forEach((s, i) => {
    const ws = wb.addWorksheet(names[i], s.plain ? {} : { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(s.header).font = { bold: true };
    s.rows.forEach((r, ri) => {
      const row = ws.addRow(r);
      if (s.boldRows?.includes(ri)) row.font = { bold: true };
    });
    const wrap = new Set(s.wrap ?? []);
    ws.columns.forEach((col, ci) => {
      const w = Math.max(width(s.header[ci] ?? null), ...s.rows.slice(0, 500).map((r) => width(r[ci] ?? null)));
      col.width = Math.min(wrap.has(ci) ? 50 : 60, Math.max(8, w + 2));
      if (wrap.has(ci)) col.alignment = { wrapText: true, vertical: 'top' };
    });
    for (const key of s.red ?? []) {
      const [r, c] = key.split(',').map(Number);
      const cell = ws.getCell(r + 2, c + 1);
      cell.font = { color: { argb: 'FFC00000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE4E4' } };
    }
  });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** 读回第一个工作表（测试用） */
export async function readFirstSheet(bytes: Uint8Array): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const out: unknown[][] = [];
  wb.worksheets[0].eachRow((row) => out.push((row.values as unknown[]).slice(1)));
  return out;
}

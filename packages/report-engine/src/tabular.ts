import type { WorksheetRow } from './types.js';

/** Escape CSV cell */
function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(headers: string[], rows: WorksheetRow[]): string {
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ];
  return lines.join('\n');
}

/**
 * Minimal SpreadsheetML workbook (Excel-compatible XML).
 * Saved as .xls so Excel/LibreOffice open it without OOXML packaging.
 */
export function rowsToSpreadsheetMl(
  sheetName: string,
  headers: string[],
  rows: WorksheetRow[],
): string {
  const cell = (v: unknown) =>
    `<Cell><Data ss:Type="String">${escapeXml(String(v ?? ''))}</Data></Cell>`;
  const headerRow = `<Row>${headers.map(cell).join('')}</Row>`;
  const dataRows = rows
    .map(
      (r) =>
        `<Row>${headers.map((h) => cell(r[h])).join('')}</Row>`,
    )
    .join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>
   ${headerRow}
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function rowsToHtmlTable(
  title: string,
  headers: string[],
  rows: WorksheetRow[],
): string {
  const th = headers.map((h) => `<th>${escapeXml(h)}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${headers.map((h) => `<td>${escapeXml(String(r[h] ?? ''))}</td>`).join('')}</tr>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escapeXml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;padding:24px;color:#111}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
th{background:#f4f4f5}
</style></head>
<body><h1>${escapeXml(title)}</h1>
<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}

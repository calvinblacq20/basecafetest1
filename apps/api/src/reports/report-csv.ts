export type CsvValue = string | number | boolean | null | undefined;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const rendered = String(value);
  return /[",\r\n]/.test(rendered)
    ? `"${rendered.replaceAll('"', '""')}"`
    : rendered;
}

export function renderCsv(
  headers: readonly string[],
  rows: readonly Readonly<Record<string, CsvValue>>[],
): string {
  return [
    headers.map(cell).join(","),
    ...rows.map((row) => headers.map((header) => cell(row[header])).join(",")),
  ]
    .join("\r\n")
    .concat("\r\n");
}

export function toCsv(rows: Record<string, any>[], headers: string[]) {
const esc = (v: any) => {
const s = v === null || v === undefined ? "" : String(v);
const needs = /[",\n\r]/.test(s);
const t = s.replace(/"/g, '""');
return needs ? `"${t}"` : t;
};

const lines: string[] = [];
lines.push(headers.map(esc).join(","));
for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
return lines.join("\r\n");
}

export function downloadTextFile(filename: string, text: string) {
const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
}
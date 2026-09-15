import { google, sheets_v4 } from "googleapis";
import { Entry, Goal } from "./types";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;
const LANCAMENTOS_TAB = "Lancamentos";
const METAS_TAB = "Metas";
const MONTH_TABS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

let cachedClient: sheets_v4.Sheets | null = null;
let setupPromise: Promise<void> | null = null;
let spreadsheetMode: "monthly" | "legacy" | null = null;
let legacyArchiveAvailable = false;

export function isUnsupportedSpreadsheetError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("must not be an Office file");
}

function getClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key || !SPREADSHEET_ID) {
    throw new Error("Variáveis de ambiente ausentes: GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY e/ou GOOGLE_SHEET_ID.");
  }
  const auth = new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

async function ensureSpreadsheetStructure(): Promise<void> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    const spreadsheet = await getClient().spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: "sheets.properties.title" });
    const titles = new Set((spreadsheet.data.sheets || []).map((sheet) => sheet.properties?.title));
    if (MONTH_TABS.some((title) => titles.has(title))) {
      spreadsheetMode = "monthly";
      legacyArchiveAvailable = titles.has(LANCAMENTOS_TAB);
      return;
    }
    spreadsheetMode = "legacy";
    const missing = [LANCAMENTOS_TAB, METAS_TAB].filter((title) => !titles.has(title));
    if (missing.length > 0) {
      await getClient().spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) } });
    }
    const headers = [
      { range: `${LANCAMENTOS_TAB}!A1:J1`, values: [["ID", "Data", "Tipo", "Descricao", "Categoria", "Pessoa", "TipoDespesa", "PercJoao", "Valor", "Excluido"]] },
      { range: `${METAS_TAB}!A1:F1`, values: [["ID", "Nome", "ValorObjetivo", "ValorGuardado", "DataLimite", "Excluido"]] },
    ];
    const current = await Promise.all(headers.map(({ range }) => getClient().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range })));
    const writes = headers.filter((_, index) => !current[index].data.values?.length);
    if (writes.length > 0) await getClient().spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: "RAW", data: writes } });
  })().catch((error) => { setupPromise = null; throw error; });
  return setupPromise;
}

async function readRange(range: string): Promise<string[][]> {
  await ensureSpreadsheetStructure();
  const response = await getClient().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  return (response.data.values as string[][]) || [];
}

function parseMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim().replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".");
  const number = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parsePercent(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const text = String(value).trim();
  const number = Number(text.replace("%", "").replace(",", "."));
  if (!Number.isFinite(number)) return null;
  return text.includes("%") || number > 1 ? number / 100 : number;
}

function normalizeSheetDate(value: unknown): string {
  const text = String(value ?? "").trim();
  const brazilian = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brazilian) return `${brazilian[3]}-${brazilian[2].padStart(2, "0")}-${brazilian[1].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return text;
}

function personFromSheet(value: unknown): Entry["pessoa"] {
  const person = String(value).trim();
  return person === "Pessoa 1" || person === "João" ? "João" : "Manuela";
}

function personToSheet(value: Entry["pessoa"]): string {
  return value;
}

function monthTabFromDate(date: string): string {
  return MONTH_TABS[Number(date.slice(5, 7)) - 1] || "Jan";
}

function metadataId(tab: string, row: number, value: unknown): string {
  return String(value || `${tab}:${row}`);
}

async function getMonthlyEntries(): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const tab of MONTH_TABS) {
    const rows = await readRange(`${tab}!A1:K100`);
    const revenueTotal = rows.findIndex((row, index) => index >= 4 && String(row[0] || "").trim().toUpperCase() === "TOTAL RECEITAS");
    const expenseHeader = rows.findIndex((row) => String(row[0] || "").trim().toUpperCase() === "DESPESAS");
    const expenseTotal = rows.findIndex((row, index) => index > expenseHeader && String(row[0] || "").trim().toUpperCase() === "TOTAL DESPESAS");
    const revenueEnd = revenueTotal === -1 ? 16 : revenueTotal;
    const expenseStart = expenseHeader === -1 ? 20 : expenseHeader + 2;
    const expenseEnd = expenseTotal === -1 ? 44 : expenseTotal;
    for (let index = 4; index < revenueEnd; index++) {
      const row = rows[index] || [];
      if (!row[0] || String(row[10] || "").toUpperCase() === "TRUE") continue;
      entries.push({ id: metadataId(tab, index + 1, row[9]), data: normalizeSheetDate(row[2]), tipo: "receita", descricao: String(row[0]), categoria: null, pessoa: personFromSheet(row[1]), despesaTipo: null, percJoao: null, valor: parseMoney(row[3]) });
    }
    for (let index = expenseStart; index < expenseEnd; index++) {
      const row = rows[index] || [];
      if (!row[0] || String(row[10] || "").toUpperCase() === "TRUE") continue;
      entries.push({ id: metadataId(tab, index + 1, row[9]), data: normalizeSheetDate(row[2]), tipo: "despesa", descricao: String(row[0]), categoria: row[1] ? String(row[1]) : null, pessoa: personFromSheet(row[4]), despesaTipo: (row[5] as Entry["despesaTipo"]) || null, percJoao: parsePercent(row[6]), valor: parseMoney(row[3]) });
    }
  }
  if (legacyArchiveAvailable) entries.push(...await getLegacyEntries());
  return entries;
}

async function getLegacyEntries(): Promise<Entry[]> {
  const rows = await readRange(`${LANCAMENTOS_TAB}!A2:J`);
  return rows.filter((row) => String(row[9] || "").toUpperCase() !== "TRUE").map((row) => ({ id: row[0], data: row[1], tipo: row[2] as Entry["tipo"], descricao: row[3] || "", categoria: row[4] || null, pessoa: row[5] as Entry["pessoa"], despesaTipo: (row[6] as Entry["despesaTipo"]) || null, percJoao: row[7] !== undefined && row[7] !== "" ? Number(row[7]) : null, valor: parseMoney(row[8]) }));
}

export async function getEntries(): Promise<Entry[]> {
  await ensureSpreadsheetStructure();
  return spreadsheetMode === "monthly" ? getMonthlyEntries() : getLegacyEntries();
}

async function updateRange(range: string, values: (string | number)[][]): Promise<void> {
  await getClient().spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range, valueInputOption: "USER_ENTERED", requestBody: { values } });
}

async function findMonthlyRow(tab: string, start: number, end: number): Promise<number | null> {
  const rows = await readRange(`${tab}!A${start}:K${end}`);
  if (rows.length === 0) return start;
  const row = rows.findIndex((values) => !String(values[0] || "").trim());
  return row === -1 ? null : start + row;
}

async function insertMonthlyRow(tab: string, beforeRow: number): Promise<number> {
  await getClient().spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        insertDimension: {
          range: { sheetId: await getSheetId(tab), dimension: "ROWS", startIndex: beforeRow - 1, endIndex: beforeRow },
          inheritFromBefore: true,
        },
      }],
    },
  });
  return beforeRow;
}

async function getSheetId(title: string): Promise<number> {
  const spreadsheet = await getClient().spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: "sheets.properties" });
  const sheet = spreadsheet.data.sheets?.find((item) => item.properties?.title === title);
  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) throw new Error(`Aba mensal não encontrada: ${title}`);
  return sheet.properties.sheetId;
}

async function syncMonthlyCalculations(tab: string): Promise<void> {
  const markerRows = await readRange(`${tab}!A1:A100`);
  const totalIndex = markerRows.findIndex((row) => String(row[0] || "").trim().toUpperCase() === "TOTAL DESPESAS");
  const totalRow = totalIndex === -1 ? 45 : totalIndex + 1;
  const endRow = totalRow - 1;
  const expenseRows = await readRange(`${tab}!A21:G${endRow}`);
  for (let index = 0; index < expenseRows.length; index++) {
    if (!String(expenseRows[index]?.[0] || "").trim()) continue;
    const row = index + 21;
    await updateRange(`${tab}!H${row}:I${row}`, [[`=D${row}*G${row}`, `=D${row}*(1-G${row})`]]);
  }
  const paidIndex = markerRows.findIndex((row, index) => index > totalIndex && String(row[0] || "").trim().toUpperCase() === "PAGOU");
  const situationIndex = markerRows.findIndex((row, index) => index > totalIndex && String(row[0] || "").trim().toUpperCase() === "SITUAÇÃO");
  const paidRow = paidIndex === -1 ? totalRow + 9 : paidIndex + 1;
  const situationRow = situationIndex === -1 ? paidRow + 3 : situationIndex + 2;
  await updateRange(`${tab}!B${paidRow}:C${paidRow}`, [[
    `=SUMIF(E21:E${endRow};"João";D21:D${endRow})`,
    `=SUMIF(E21:E${endRow};"Manuela";D21:D${endRow})`,
  ]]);
  await updateRange(`${tab}!B${situationRow}`, [[`=IF(B${paidRow + 2}>0;"Manuela deve "&TEXT(B${paidRow + 2};"R$ #,##0.00")&" a João";IF(B${paidRow + 2}<0;"João deve "&TEXT(-B${paidRow + 2};"R$ #,##0.00")&" a Manuela";"Contas quitadas entre vocês"))`]]);
}

export async function addEntry(entry: Entry): Promise<void> {
  await ensureSpreadsheetStructure();
  if (spreadsheetMode === "legacy") {
    await updateRange(`${LANCAMENTOS_TAB}!A:Z`, [[entry.id, entry.data, entry.tipo, entry.descricao, entry.categoria ?? "", entry.pessoa, entry.despesaTipo ?? "", entry.percJoao ?? "", entry.valor, "FALSE"]]);
    return;
  }
  const tab = monthTabFromDate(entry.data);
  if (entry.tipo === "receita") {
    const row = await findMonthlyRow(tab, 5, 16) || await insertMonthlyRow(tab, 17);
    await updateRange(`${tab}!A${row}:D${row}`, [[entry.descricao, personToSheet(entry.pessoa), entry.data, entry.valor]]);
    await updateRange(`${tab}!J${row}:K${row}`, [[entry.id, "FALSE"]]);
  } else {
    const row = await findMonthlyRow(tab, 21, 44) || await insertMonthlyRow(tab, 45);
    await updateRange(`${tab}!A${row}:G${row}`, [[entry.descricao, entry.categoria ?? "Outros", entry.data, entry.valor, personToSheet(entry.pessoa), entry.despesaTipo ?? "Individual", entry.percJoao ?? 0.5]]);
    await updateRange(`${tab}!J${row}:K${row}`, [[entry.id, "FALSE"]]);
  }
  await syncMonthlyCalculations(tab);
}

async function updateDeletedById(id: string): Promise<void> {
  for (const tab of MONTH_TABS) {
    const rows = await readRange(`${tab}!J5:K44`);
    const index = rows.findIndex((row) => row[0] === id || `${tab}:${rows.indexOf(row) + 5}` === id);
    if (index !== -1) { await updateRange(`${tab}!K${index + 5}`, [["TRUE"]]); return; }
  }
  if (legacyArchiveAvailable) {
    const rows = await readRange(`${LANCAMENTOS_TAB}!A2:A`);
    const index = rows.findIndex((row) => row[0] === id);
    if (index !== -1) await updateRange(`${LANCAMENTOS_TAB}!J${index + 2}`, [["TRUE"]]);
  }
}

export async function deleteEntry(id: string): Promise<void> {
  await ensureSpreadsheetStructure();
  if (spreadsheetMode === "legacy") {
    const rows = await readRange(`${LANCAMENTOS_TAB}!A2:A`);
    const index = rows.findIndex((row) => row[0] === id);
    if (index !== -1) await updateRange(`${LANCAMENTOS_TAB}!J${index + 2}`, [["TRUE"]]);
    return;
  }
  await updateDeletedById(id);
}

async function getLegacyGoals(): Promise<Goal[]> {
  const rows = await readRange(`${METAS_TAB}!A2:F`);
  return rows.filter((row) => String(row[5] || "").toUpperCase() !== "TRUE").map((row) => ({ id: row[0], nome: row[1] || "", valorObjetivo: parseMoney(row[2]), valorGuardado: parseMoney(row[3]), dataLimite: row[4] || null }));
}

export async function getGoals(): Promise<Goal[]> {
  await ensureSpreadsheetStructure();
  if (spreadsheetMode === "legacy") return getLegacyGoals();
  const rows = await readRange(`${METAS_TAB}!A1:H18`);
  return rows.slice(3).filter((row) => row[0] && String(row[7] || "").toUpperCase() !== "TRUE").map((row, index) => ({ id: metadataId(METAS_TAB, index + 4, row[6]), nome: String(row[0]), valorObjetivo: parseMoney(row[1]), valorGuardado: parseMoney(row[2]), dataLimite: row[3] || null }));
}

export async function addGoal(goal: Goal): Promise<void> {
  await ensureSpreadsheetStructure();
  if (spreadsheetMode === "legacy") { await updateRange(`${METAS_TAB}!A:Z`, [[goal.id, goal.nome, goal.valorObjetivo, goal.valorGuardado, goal.dataLimite ?? "", "FALSE"]]); return; }
  const rows = await readRange(`${METAS_TAB}!A4:H18`);
  const index = rows.findIndex((row) => !String(row[0] || "").trim());
  if (index === -1) throw new Error("A aba Metas está sem linhas livres.");
  const row = index + 4;
  await updateRange(`${METAS_TAB}!A${row}:D${row}`, [[goal.nome, goal.valorObjetivo, goal.valorGuardado, goal.dataLimite ?? ""]]);
  await updateRange(`${METAS_TAB}!G${row}:H${row}`, [[goal.id, "FALSE"]]);
}

export async function updateGoalSaved(id: string, novoValorGuardado: number): Promise<void> {
  await ensureSpreadsheetStructure();
  if (spreadsheetMode === "legacy") { const rows = await readRange(`${METAS_TAB}!A2:A`); const index = rows.findIndex((row) => row[0] === id); if (index !== -1) await updateRange(`${METAS_TAB}!D${index + 2}`, [[novoValorGuardado]]); return; }
  const rows = await readRange(`${METAS_TAB}!A4:H18`);
  const index = rows.findIndex((row, offset) => row[6] === id || `${METAS_TAB}:${offset + 4}` === id);
  if (index !== -1) await updateRange(`${METAS_TAB}!C${index + 4}`, [[novoValorGuardado]]);
}

export async function deleteGoal(id: string): Promise<void> {
  await ensureSpreadsheetStructure();
  if (spreadsheetMode === "legacy") { const rows = await readRange(`${METAS_TAB}!A2:A`); const index = rows.findIndex((row) => row[0] === id); if (index !== -1) await updateRange(`${METAS_TAB}!F${index + 2}`, [["TRUE"]]); return; }
  const rows = await readRange(`${METAS_TAB}!A4:H18`);
  const index = rows.findIndex((row, offset) => row[6] === id || `${METAS_TAB}:${offset + 4}` === id);
  if (index !== -1) await updateRange(`${METAS_TAB}!H${index + 4}`, [["TRUE"]]);
}

import { google, sheets_v4 } from "googleapis";
import { Entry, Goal } from "./types";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;
const LANCAMENTOS_TAB = "Lancamentos";
const METAS_TAB = "Metas";

// Cabeçalhos esperados em cada aba da planilha (linha 1).
// LANCAMENTOS: ID | Data | Tipo | Descricao | Categoria | Pessoa | TipoDespesa | PercJoao | Valor | Excluido
// METAS:       ID | Nome | ValorObjetivo | ValorGuardado | DataLimite | Excluido
const LANCAMENTOS_HEADERS = ["ID", "Data", "Tipo", "Descricao", "Categoria", "Pessoa", "TipoDespesa", "PercJoao", "Valor", "Excluido"];
const METAS_HEADERS = ["ID", "Nome", "ValorObjetivo", "ValorGuardado", "DataLimite", "Excluido"];

let cachedClient: sheets_v4.Sheets | null = null;
let setupPromise: Promise<void> | null = null;

function getClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key || !SPREADSHEET_ID) {
    throw new Error(
      "Variáveis de ambiente ausentes: GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY e/ou GOOGLE_SHEET_ID."
    );
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
    const client = getClient();
    const spreadsheet = await client.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets.properties.title",
    });
    const existing = new Set((spreadsheet.data.sheets || []).map((sheet) => sheet.properties?.title));
    const missing = [LANCAMENTOS_TAB, METAS_TAB].filter((title) => !existing.has(title));

    if (missing.length > 0) {
      await client.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      });
    }

    const ranges = [
      { range: `${LANCAMENTOS_TAB}!A1:J1`, values: [LANCAMENTOS_HEADERS] },
      { range: `${METAS_TAB}!A1:F1`, values: [METAS_HEADERS] },
    ];
    const currentHeaders = await Promise.all(ranges.map(({ range }) => client.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range })));
    const writes = ranges.flatMap(({ range, values }, index) => currentHeaders[index].data.values?.length ? [] : [{ range, values }]);
    if (writes.length > 0) {
      await client.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: "RAW", data: writes },
      });
    }
  })().catch((error) => {
    setupPromise = null;
    throw error;
  });
  return setupPromise;
}

// ------------------------------------------------------------------
// Helpers genéricos
// ------------------------------------------------------------------

async function readRange(range: string): Promise<string[][]> {
  await ensureSpreadsheetStructure();
  const client = getClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });
  return (res.data.values as string[][]) || [];
}

async function appendRow(tab: string, row: (string | number)[]): Promise<void> {
    await ensureSpreadsheetStructure();
  const client = getClient();
  await client.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

/** Localiza o número da linha (1-based, considerando o cabeçalho) de um ID na coluna A de uma aba. */
async function findRowById(tab: string, id: string): Promise<number | null> {
  const values = await readRange(`${tab}!A2:A`);
  const idx = values.findIndex((r) => r[0] === id);
  return idx === -1 ? null : idx + 2; // +2: linha 1 é cabeçalho, array é 0-based
}

async function updateCell(tab: string, row: number, column: string, value: string | number): Promise<void> {
    await ensureSpreadsheetStructure();
  const client = getClient();
  await client.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!${column}${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });
}

// ------------------------------------------------------------------
// Lançamentos (receitas e despesas)
// ------------------------------------------------------------------

export async function getEntries(): Promise<Entry[]> {
  const rows = await readRange(`${LANCAMENTOS_TAB}!A2:J`);
  return rows
    .filter((r) => (r[9] || "").toUpperCase() !== "TRUE") // não excluídos
    .map((r) => ({
      id: r[0],
      data: r[1],
      tipo: r[2] as Entry["tipo"],
      descricao: r[3] || "",
      categoria: r[4] || null,
      pessoa: r[5] as Entry["pessoa"],
      despesaTipo: (r[6] as Entry["despesaTipo"]) || null,
      percJoao: r[7] !== undefined && r[7] !== "" ? Number(r[7]) : null,
      valor: Number(r[8] || 0),
    }));
}

export async function addEntry(entry: Entry): Promise<void> {
  await appendRow(LANCAMENTOS_TAB, [
    entry.id,
    entry.data,
    entry.tipo,
    entry.descricao,
    entry.categoria ?? "",
    entry.pessoa,
    entry.despesaTipo ?? "",
    entry.percJoao ?? "",
    entry.valor,
    "FALSE",
  ]);
}

export async function deleteEntry(id: string): Promise<void> {
  const row = await findRowById(LANCAMENTOS_TAB, id);
  if (row) await updateCell(LANCAMENTOS_TAB, row, "J", "TRUE");
}

// ------------------------------------------------------------------
// Metas
// ------------------------------------------------------------------

export async function getGoals(): Promise<Goal[]> {
  const rows = await readRange(`${METAS_TAB}!A2:F`);
  return rows
    .filter((r) => (r[5] || "").toUpperCase() !== "TRUE")
    .map((r) => ({
      id: r[0],
      nome: r[1] || "",
      valorObjetivo: Number(r[2] || 0),
      valorGuardado: Number(r[3] || 0),
      dataLimite: r[4] || null,
    }));
}

export async function addGoal(goal: Goal): Promise<void> {
  await appendRow(METAS_TAB, [
    goal.id,
    goal.nome,
    goal.valorObjetivo,
    goal.valorGuardado,
    goal.dataLimite ?? "",
    "FALSE",
  ]);
}

export async function updateGoalSaved(id: string, novoValorGuardado: number): Promise<void> {
  const row = await findRowById(METAS_TAB, id);
  if (row) await updateCell(METAS_TAB, row, "D", novoValorGuardado);
}

export async function deleteGoal(id: string): Promise<void> {
  const row = await findRowById(METAS_TAB, id);
  if (row) await updateCell(METAS_TAB, row, "F", "TRUE");
}

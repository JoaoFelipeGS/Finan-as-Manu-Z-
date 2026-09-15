import { NextRequest, NextResponse } from "next/server";
import { getEntries, addEntry, deleteEntry, isUnsupportedSpreadsheetError } from "@/lib/sheets";
import { Entry } from "@/lib/types";

export const dynamic = "force-dynamic";

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

export async function GET() {
  try {
    const entries = await getEntries();
    return NextResponse.json(entries);
  } catch (err: any) {
    console.error(err);
    if (isUnsupportedSpreadsheetError(err)) {
      return NextResponse.json({ error: "A planilha precisa ser convertida para o formato Google Sheets." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível carregar os lançamentos." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const valor = Number(body.valor);
    if (!Number.isFinite(valor) || valor <= 0 || valor > 100000000) {
      return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
    }
    if (typeof body.descricao !== "string" || body.descricao.trim().length === 0 || body.descricao.length > 200) {
      return NextResponse.json({ error: "Descrição é obrigatória." }, { status: 400 });
    }
    if (!isValidDate(body.data) || !["receita", "despesa"].includes(body.tipo) || !["João", "Manuela"].includes(body.pessoa)) {
      return NextResponse.json({ error: "Dados do lançamento inválidos." }, { status: 400 });
    }
    if (body.tipo === "despesa" && !["Compartilhada", "Individual"].includes(body.despesaTipo)) {
      return NextResponse.json({ error: "Tipo de despesa inválido." }, { status: 400 });
    }
    const percJoao = body.tipo === "despesa" && body.despesaTipo === "Compartilhada" ? Number(body.percJoao) : null;
    if (percJoao !== null && (!Number.isFinite(percJoao) || percJoao < 0 || percJoao > 1)) {
      return NextResponse.json({ error: "Divisão inválida." }, { status: 400 });
    }

    const entry: Entry = {
      id: crypto.randomUUID(),
      data: body.data,
      tipo: body.tipo,
      descricao: body.descricao.trim(),
      categoria: typeof body.categoria === "string" ? body.categoria.trim().slice(0, 80) : null,
      pessoa: body.pessoa,
      despesaTipo: body.despesaTipo ?? null,
      percJoao,
      valor,
    };

    await addEntry(entry);
    return NextResponse.json(entry, { status: 201 });
  } catch (err: any) {
    console.error(err);
    if (isUnsupportedSpreadsheetError(err)) {
      return NextResponse.json({ error: "A planilha precisa ser convertida para o formato Google Sheets." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível salvar o lançamento." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id é obrigatório." }, { status: 400 });
    await deleteEntry(id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    if (isUnsupportedSpreadsheetError(err)) {
      return NextResponse.json({ error: "A planilha precisa ser convertida para o formato Google Sheets." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível excluir o lançamento." }, { status: 500 });
  }
}

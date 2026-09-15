import { NextRequest, NextResponse } from "next/server";
import { getEntries, addEntry, deleteEntry } from "@/lib/sheets";
import { Entry } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await getEntries();
    return NextResponse.json(entries);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.valor || body.valor <= 0) {
      return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
    }
    if (!body.descricao) {
      return NextResponse.json({ error: "Descrição é obrigatória." }, { status: 400 });
    }

    const entry: Entry = {
      id: crypto.randomUUID(),
      data: body.data,
      tipo: body.tipo,
      descricao: body.descricao,
      categoria: body.categoria ?? null,
      pessoa: body.pessoa,
      despesaTipo: body.despesaTipo ?? null,
      percJoao: body.percJoao ?? null,
      valor: Number(body.valor),
    };

    await addEntry(entry);
    return NextResponse.json(entry, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

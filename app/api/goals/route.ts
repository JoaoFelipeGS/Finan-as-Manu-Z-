import { NextRequest, NextResponse } from "next/server";
import { getGoals, addGoal, updateGoalSaved, deleteGoal } from "@/lib/sheets";
import { Goal } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const goals = await getGoals();
    return NextResponse.json(goals);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível carregar as metas." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const valorObjetivo = Number(body.valorObjetivo);
    const valorGuardado = Number(body.valorGuardado ?? 0);
    if (typeof body.nome !== "string" || body.nome.trim().length === 0 || body.nome.length > 120) {
      return NextResponse.json({ error: "Nome e valor objetivo são obrigatórios." }, { status: 400 });
    }
    if (!Number.isFinite(valorObjetivo) || valorObjetivo <= 0 || !Number.isFinite(valorGuardado) || valorGuardado < 0) {
      return NextResponse.json({ error: "Valores da meta inválidos." }, { status: 400 });
    }
    if (body.dataLimite !== null && body.dataLimite !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.dataLimite)) {
      return NextResponse.json({ error: "Data limite inválida." }, { status: 400 });
    }

    const goal: Goal = {
      id: crypto.randomUUID(),
      nome: body.nome.trim(),
      valorObjetivo,
      valorGuardado,
      dataLimite: body.dataLimite ?? null,
    };

    await addGoal(goal);
    return NextResponse.json(goal, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível criar a meta." }, { status: 500 });
  }
}

// Atualiza o valor guardado de uma meta (soma incremento ao valor atual, enviado já calculado pelo front)
export async function PATCH(req: NextRequest) {
  try {
    const { id, valorGuardado } = await req.json();
    const numericValue = Number(valorGuardado);
    if (typeof id !== "string" || id.length > 100 || !Number.isFinite(numericValue) || numericValue < 0) {
      return NextResponse.json({ error: "id e valorGuardado são obrigatórios." }, { status: 400 });
    }
    await updateGoalSaved(id, numericValue);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível atualizar a meta." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id é obrigatório." }, { status: 400 });
    await deleteGoal(id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível excluir a meta." }, { status: 500 });
  }
}

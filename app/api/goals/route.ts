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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.nome || !body.valorObjetivo) {
      return NextResponse.json({ error: "Nome e valor objetivo são obrigatórios." }, { status: 400 });
    }

    const goal: Goal = {
      id: crypto.randomUUID(),
      nome: body.nome,
      valorObjetivo: Number(body.valorObjetivo),
      valorGuardado: Number(body.valorGuardado ?? 0),
      dataLimite: body.dataLimite ?? null,
    };

    await addGoal(goal);
    return NextResponse.json(goal, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Atualiza o valor guardado de uma meta (soma incremento ao valor atual, enviado já calculado pelo front)
export async function PATCH(req: NextRequest) {
  try {
    const { id, valorGuardado } = await req.json();
    if (!id || valorGuardado === undefined) {
      return NextResponse.json({ error: "id e valorGuardado são obrigatórios." }, { status: 400 });
    }
    await updateGoalSaved(id, Number(valorGuardado));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

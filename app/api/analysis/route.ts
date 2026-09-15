import { NextRequest, NextResponse } from "next/server";
import { FinancialSummary } from "@/lib/types";

export const dynamic = "force-dynamic";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const PREFERRED_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];

function isSummary(value: unknown): value is FinancialSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as FinancialSummary;
  return [
    summary.receitas,
    summary.despesas,
    summary.saldo,
    summary.receitaJoao,
    summary.receitaManuela,
    summary.despesaJoao,
    summary.despesaManuela,
    summary.despesasCompartilhadas,
    summary.despesasIndividuais,
  ].every((value) => typeof value === "number" && Number.isFinite(value))
    && Array.isArray(summary.porCategoria)
    && summary.porCategoria.length <= 50;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "A análise inteligente ainda não foi configurada." }, { status: 503 });
  }

  try {
    const body = await req.json();
    if (!isSummary(body.summary)) {
      return NextResponse.json({ error: "Resumo financeiro inválido." }, { status: 400 });
    }

    const models = await getAvailableModels(apiKey);
    if (models.length === 0) {
      console.error("Groq has no compatible chat model available");
      return NextResponse.json({ error: "A Groq não disponibilizou um modelo de análise." }, { status: 503 });
    }

    let response: Response | null = null;
    for (const model of models) {
      response = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 500,
          messages: [
            {
              role: "system",
              content: "Você é um orientador financeiro prudente. Analise somente os números fornecidos, não invente fatos, não recomende investimentos específicos ou arriscados e deixe claro que é uma estimativa. Responda em português do Brasil com 3 a 5 recomendações práticas, incluindo quanto reduzir em despesas e quanto reservar para investir, sempre em reais e sem prometer retorno.",
            },
            {
              role: "user",
              content: `Analise este resumo mensal do casal e dê dicas objetivas:\n${JSON.stringify(body.summary)}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status !== 404 && response.status !== 400) break;
      console.warn("Groq model unavailable, trying fallback", model);
    }

    if (!response || !response.ok) {
      console.error("Groq API error", response?.status);
      return NextResponse.json({ error: "Não foi possível gerar a análise agora." }, { status: 502 });
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content;
    if (typeof analysis !== "string" || analysis.length === 0 || analysis.length > 5000) {
      return NextResponse.json({ error: "A análise retornou um formato inválido." }, { status: 502 });
    }
    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("Analysis error", error);
    if (error instanceof Error && error.message === "GROQ_AUTH") {
      return NextResponse.json({ error: "A chave da Groq é inválida ou está sem permissão." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível gerar a análise agora." }, { status: 502 });
  }
}

function isUsableModel(model: unknown): model is string {
  if (typeof model !== "string") return false;
  const normalized = model.toLowerCase();
  return normalized.includes("llama")
    && !normalized.includes("guard")
    && !normalized.includes("safety")
    && !normalized.includes("whisper")
    && !normalized.includes("embed");
}

async function getAvailableModels(apiKey: string): Promise<string[]> {
  const response = await fetch(GROQ_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("GROQ_AUTH");
  if (!response.ok) throw new Error(`GROQ_MODELS_${response.status}`);

  const data = await response.json();
  const available = Array.isArray(data.data)
    ? data.data.map((item: { id?: unknown }) => item.id).filter(isUsableModel)
    : [];
  const configured = process.env.GROQ_MODEL?.trim();
  const ordered = [configured, ...PREFERRED_MODELS, ...available].filter(
    (model, index, list): model is string => Boolean(model) && list.indexOf(model) === index,
  );
  return ordered.filter((model) => available.includes(model) || model === configured).slice(0, 3);
}
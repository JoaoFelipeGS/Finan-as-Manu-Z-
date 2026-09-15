"use client";

import { useEffect, useMemo, useState } from "react";
import { Entry, FinancialSummary, Goal, Pessoa, TipoDespesa, TipoLancamento } from "@/lib/types";

const CATEGORIAS = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Contas/Assinaturas", "Vestuário", "Cuidados Pessoais",
  "Presentes", "Pets", "Outros",
];
const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function brl(v: number): string {
  return (v < 0 ? "-" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Page() {
  const [tab, setTab] = useState<"inicio" | "add" | "dados" | "metas">("inicio");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  // form state
  const [tipo, setTipo] = useState<TipoLancamento>("despesa");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState(CATEGORIAS[0]);
  const [pessoa, setPessoa] = useState<Pessoa>("João");
  const [despesaTipo, setDespesaTipo] = useState<TipoDespesa>("Compartilhada");
  const [perc, setPerc] = useState(50);
  const [data, setData] = useState(todayISO());

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  useEffect(() => {
    refreshAll();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1700);
  }

  async function refreshAll() {
    setLoading(true);
    try {
      const [e, g] = await Promise.all([
        fetch("/api/entries").then((r) => r.json()),
        fetch("/api/goals").then((r) => r.json()),
      ]);
      setEntries(Array.isArray(e) ? e : []);
      setGoals(Array.isArray(g) ? g : []);
    } catch (err) {
      console.error(err);
      showToast("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }

  const monthEntries = useMemo(() => {
    return entries.filter((e) => {
      const d = new Date(e.data + "T00:00:00");
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }, [entries, month, year]);

  const summary = useMemo(() => {
    let receitas = 0, despesas = 0, pagoJoao = 0, pagoManuela = 0, receitaJoao = 0, receitaManuela = 0, despesasCompartilhadas = 0, despesasIndividuais = 0, deveJoao = 0, deveManuela = 0;
    const categories = new Map<string, number>();
    monthEntries.forEach((e) => {
      if (e.tipo === "receita") {
        receitas += e.valor;
        if (e.pessoa === "João") receitaJoao += e.valor; else receitaManuela += e.valor;
        return;
      }
      despesas += e.valor;
      const category = e.categoria || "Outros";
      categories.set(category, (categories.get(category) || 0) + e.valor);
      if (e.pessoa === "João") pagoJoao += e.valor; else pagoManuela += e.valor;
      if (e.despesaTipo === "Compartilhada") {
        despesasCompartilhadas += e.valor;
        const pj = e.percJoao ?? 0.5;
        deveJoao += e.valor * pj;
        deveManuela += e.valor * (1 - pj);
      } else {
        despesasIndividuais += e.valor;
        if (e.pessoa === "João") deveJoao += e.valor; else deveManuela += e.valor;
      }
    });
    return { receitas, despesas, pagoJoao, pagoManuela, despesaJoao: pagoJoao, despesaManuela: pagoManuela, receitaJoao, receitaManuela, despesasCompartilhadas, despesasIndividuais, deveJoao, deveManuela, saldo: receitas - despesas, porCategoria: [...categories.entries()].map(([categoria, valor]) => ({ categoria, valor })).sort((a, b) => b.valor - a.valor) };
  }, [monthEntries]);

  async function handleAnalysis() {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: summary as FinancialSummary }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Falha na análise");
      setAnalysis(body.analysis);
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : "Análise indisponível");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    const v = parseFloat(valor.replace(",", "."));
    if (!v || v <= 0) { showToast("Informe um valor válido"); return; }
    if (!descricao.trim()) { showToast("Informe uma descrição"); return; }

    setSaving(true);
    try {
      const payload = {
        tipo, valor: v, descricao: descricao.trim(), data,
        categoria: tipo === "despesa" ? categoria : null,
        pessoa,
        despesaTipo: tipo === "despesa" ? despesaTipo : null,
        percJoao: tipo === "despesa" && despesaTipo === "Compartilhada" ? perc / 100 : null,
      };
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Falha ao salvar");

      setValor(""); setDescricao("");
      const d = new Date(data + "T00:00:00");
      setMonth(d.getMonth()); setYear(d.getFullYear());
      await refreshAll();
      showToast("Lançamento salvo ✓");
      setTab("inicio");
    } catch (err) {
      console.error(err);
      showToast("Erro ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEntry(e: Entry) {
    if (!confirm(`Excluir "${e.descricao}"?`)) return;
    try {
      await fetch("/api/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id }),
      });
      await refreshAll();
    } catch (err) {
      console.error(err);
      showToast("Erro ao excluir");
    }
  }

  async function handleNewGoal() {
    const nome = prompt("Nome da meta (ex: Reserva de emergência):");
    if (!nome) return;
    const objetivo = parseFloat((prompt("Valor objetivo (R$):") || "").replace(",", "."));
    if (!objetivo || objetivo <= 0) { showToast("Valor inválido"); return; }
    const guardadoStr = prompt("Valor já guardado (R$) — pode deixar 0:", "0");
    const guardado = parseFloat((guardadoStr || "0").replace(",", ".")) || 0;
    const prazo = prompt("Data limite (AAAA-MM-DD) — opcional:", "") || null;

    try {
      await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, valorObjetivo: objetivo, valorGuardado: guardado, dataLimite: prazo }),
      });
      await refreshAll();
      showToast("Meta criada ✓");
    } catch (err) {
      console.error(err);
      showToast("Erro ao criar meta");
    }
  }

  async function handleAddToGoal(g: Goal) {
    const v = prompt("Quanto vocês querem adicionar a essa meta? (R$)");
    const n = parseFloat((v || "").replace(",", "."));
    if (!n || n <= 0) return;
    try {
      await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: g.id, valorGuardado: g.valorGuardado + n }),
      });
      await refreshAll();
      showToast("Meta atualizada ✓");
    } catch (err) {
      console.error(err);
      showToast("Erro ao atualizar meta");
    }
  }

  async function handleDeleteGoal(g: Goal) {
    if (!confirm("Excluir esta meta?")) return;
    try {
      await fetch("/api/goals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: g.id }),
      });
      await refreshAll();
    } catch (err) {
      console.error(err);
      showToast("Erro ao excluir meta");
    }
  }

  function handleExportCsv() {
    if (entries.length === 0) { showToast("Nada para exportar ainda"); return; }
    const header = "Data,Tipo,Descricao,Categoria,Pessoa,Tipo Despesa,% Joao,Valor\n";
    const rows = entries.map((e) => [
      e.data, e.tipo, `"${(e.descricao || "").replace(/"/g, '""')}"`, e.categoria || "", e.pessoa,
      e.despesaTipo || "", e.percJoao != null ? Math.round(e.percJoao * 100) : "", e.valor.toFixed(2),
    ].join(",")).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "lancamentos_joao_manuela.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("CSV exportado ✓");
  }

  const totalPago = summary.pagoJoao + summary.pagoManuela;
  const pctJoao = totalPago > 0 ? (summary.pagoJoao / totalPago) * 100 : 50;
  const diff = summary.pagoJoao - summary.deveJoao;

  if (loading) {
    return <div className="loading-screen">Carregando…</div>;
  }

  return (
    <div id="app">
      <div className="top-actions">
        <button className="icon-btn logout-btn" title="Sair" onClick={handleLogout} aria-label="Sair">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 17l5-5-5-5M15 12H3" /><path d="M21 3v18" />
          </svg>
        </button>
        <button className="icon-btn" title="Exportar CSV" onClick={handleExportCsv}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
          </svg>
        </button>
      </div>

      {tab === "inicio" && (
        <section>
          <header>
            <div className="brand">Nosso Dinheiro · João &amp; Manuela</div>
            <div className="month-row">
              <h1>{MESES_PT[month]} {year}</h1>
              <div className="month-nav">
                <button className="month-btn" onClick={() => {
                  let m = month - 1, y = year; if (m < 0) { m = 11; y--; } setMonth(m); setYear(y);
                }}>‹</button>
                <button className="month-btn" onClick={() => {
                  let m = month + 1, y = year; if (m > 11) { m = 0; y++; } setMonth(m); setYear(y);
                }}>›</button>
              </div>
            </div>
          </header>

          <div className="hero">
            <div className="hero-label">Saldo do mês</div>
            <div className={"hero-value " + (summary.saldo > 0 ? "pos" : summary.saldo < 0 ? "neg" : "")}>
              {brl(summary.saldo)}
            </div>

            <div className="split-bar">
              <div className="j" style={{ width: pctJoao + "%" }} />
              <div className="m" style={{ width: (100 - pctJoao) + "%" }} />
            </div>
            <div className="split-legend">
              <span><span className="dot j" />João pagou <b>{brl(summary.pagoJoao)}</b></span>
              <span>Manuela pagou <b>{brl(summary.pagoManuela)}</b><span className="dot m" style={{ marginLeft: 5 }} /></span>
            </div>
            <div className="settle">
              {Math.abs(diff) < 0.01
                ? (totalPago > 0 ? <>Contas <b>quitadas</b> entre vocês</> : "Sem despesas compartilhadas ainda")
                : diff > 0
                  ? <>Manuela deve <b>{brl(diff)}</b> a João</>
                  : <>João deve <b>{brl(-diff)}</b> a Manuela</>}
            </div>
          </div>

          <div className="section-title"><span>Últimos lançamentos</span><span>este mês</span></div>
          <div className="entries">
            {monthEntries.length === 0 && (
              <div className="empty-state">Nenhum lançamento neste mês ainda.<br />Toque em &quot;Adicionar&quot; para começar.</div>
            )}
            {[...monthEntries].sort((a, b) => b.data.localeCompare(a.data)).map((e) => {
              const [, m, d] = e.data.split("-");
              return (
                <div className="entry" key={e.id} onClick={() => handleDeleteEntry(e)}>
                  <div className={"stripe " + (e.pessoa === "João" ? "j" : "m")} />
                  <div className="info">
                    <div className="desc">{e.descricao}</div>
                    <div className="meta">
                      {d}/{m} · {e.pessoa}{e.categoria ? " · " + e.categoria : ""}{e.despesaTipo ? " · " + e.despesaTipo : ""}
                    </div>
                  </div>
                  <div className={"amount " + (e.tipo === "receita" ? "in" : "out")}>
                    {e.tipo === "receita" ? "+" : "-"} {brl(e.valor)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === "add" && (
        <section>
          <header><div className="brand">Novo lançamento</div><h1 style={{ marginTop: 4 }}>Adicionar</h1></header>
          <div className="form-wrap">
            <div className="seg">
              <button className={tipo === "despesa" ? "active" : ""} onClick={() => setTipo("despesa")}>Despesa</button>
              <button className={tipo === "receita" ? "active" : ""} onClick={() => setTipo("receita")}>Receita</button>
            </div>

            <div className="amount-input-wrap">
              <label>Valor</label>
              <input className="amount-input" inputMode="decimal" placeholder="R$ 0,00"
                value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>

            <div className="field">
              <label>Descrição</label>
              <input type="text" placeholder="Ex: Mercado do mês"
                value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>

            {tipo === "despesa" && (
              <div className="field">
                <label>Categoria</label>
                <div className="chips">
                  {CATEGORIAS.map((c) => (
                    <button key={c} className={"chip " + (categoria === c ? "active" : "")}
                      onClick={() => setCategoria(c)}>{c}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <label>{tipo === "despesa" ? "Quem pagou" : "De quem é a receita"}</label>
              <div className="person-toggle">
                <button className={"person-btn j " + (pessoa === "João" ? "active" : "")}
                  onClick={() => setPessoa("João")}>João</button>
                <button className={"person-btn m " + (pessoa === "Manuela" ? "active" : "")}
                  onClick={() => setPessoa("Manuela")}>Manuela</button>
              </div>
            </div>

            {tipo === "despesa" && (
              <div className="field">
                <label>Tipo de despesa</label>
                <div className="seg">
                  <button className={despesaTipo === "Compartilhada" ? "active" : ""}
                    onClick={() => setDespesaTipo("Compartilhada")}>Compartilhada</button>
                  <button className={despesaTipo === "Individual" ? "active" : ""}
                    onClick={() => setDespesaTipo("Individual")}>Individual</button>
                </div>
              </div>
            )}

            {tipo === "despesa" && despesaTipo === "Compartilhada" && (
              <div className="field">
                <label>Divisão da despesa</label>
                <div className="slider-row">
                  <input type="range" min={0} max={100} value={perc}
                    onChange={(e) => setPerc(Number(e.target.value))} />
                  <div className="slider-val">João {perc}%</div>
                </div>
              </div>
            )}

            <div className="field">
              <label>Data</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>

            <button className="save-btn" disabled={saving} onClick={handleSave}>
              {saving ? "Salvando…" : "Salvar lançamento"}
            </button>
          </div>
        </section>
      )}

      {tab === "dados" && (
        <section>
          <header>
            <div className="brand">Leitura do mês</div>
            <div className="month-row">
              <h1>Dados</h1>
              <span className="period-label">{MESES_PT[month]} {year}</span>
            </div>
          </header>
          <div className="data-grid">
            <div className="data-card"><span>Receitas</span><strong className="positive">{brl(summary.receitas)}</strong></div>
            <div className="data-card"><span>Despesas</span><strong className="negative">{brl(summary.despesas)}</strong></div>
            <div className="data-card"><span>Saldo final</span><strong>{brl(summary.saldo)}</strong></div>
            <div className="data-card"><span>Despesas compartilhadas</span><strong>{brl(summary.despesasCompartilhadas)}</strong></div>
          </div>

          <div className="data-section">
            <div className="section-title compact"><span>Por pessoa</span><span>receitas e despesas</span></div>
            <div className="person-data">
              <div><b>João</b><span className="positive">+ {brl(summary.receitaJoao)}</span><span className="negative">- {brl(summary.pagoJoao)}</span></div>
              <div><b>Manuela</b><span className="positive">+ {brl(summary.receitaManuela)}</span><span className="negative">- {brl(summary.pagoManuela)}</span></div>
            </div>
          </div>

          <div className="data-section">
            <div className="section-title compact"><span>Despesas por categoria</span><span>{monthEntries.length} lançamentos</span></div>
            <div className="category-list">
              {summary.porCategoria.length === 0 && <div className="empty-state">Nenhuma despesa neste mês.</div>}
              {summary.porCategoria.map((item) => (
                <div className="category-row" key={item.categoria}><span>{item.categoria}</span><b>{brl(item.valor)}</b></div>
              ))}
            </div>
          </div>

          <div className="data-section insight-box">
            <div className="section-title compact"><span>Análise inteligente</span><span>Groq</span></div>
            <p className="muted-copy">Receba sugestões baseadas apenas nos números deste mês.</p>
            <button className="save-btn analysis-btn" disabled={analyzing} onClick={handleAnalysis}>
              {analyzing ? "Analisando…" : "Gerar dicas de economia"}
            </button>
            {analysis && <div className="analysis-result">{analysis}</div>}
          </div>
        </section>
      )}

      {tab === "metas" && (
        <section>
          <header>
            <div className="brand">Objetivos do casal</div>
            <div className="month-row">
              <h1>Metas</h1>
              <button className="month-btn" style={{ width: "auto", borderRadius: 20, padding: "0 14px" }}
                onClick={handleNewGoal}>+ nova</button>
            </div>
          </header>
          <div style={{ marginTop: 14 }}>
            {goals.length === 0 && (
              <div className="empty-state" style={{ margin: "0 20px" }}>
                Nenhuma meta cadastrada.<br />Toque em &quot;+ nova&quot; para criar a primeira.
              </div>
            )}
            {goals.map((g) => {
              const pct = g.valorObjetivo > 0 ? Math.min(100, (g.valorGuardado / g.valorObjetivo) * 100) : 0;
              return (
                <div className="goal-card" key={g.id}>
                  <div className="goal-top">
                    <div className="goal-name">{g.nome}</div>
                    <div className="goal-deadline">
                      {g.dataLimite ? new Date(g.dataLimite + "T00:00:00").toLocaleDateString("pt-BR") : ""}
                    </div>
                  </div>
                  <div className="goal-values">
                    <span>{brl(g.valorGuardado)} guardado</span>
                    <span>{pct.toFixed(0)}% · meta {brl(g.valorObjetivo)}</span>
                  </div>
                  <div className="goal-track"><div className="goal-fill" style={{ width: pct + "%" }} /></div>
                  <div className="goal-actions">
                    <button className="chip-btn" onClick={() => handleAddToGoal(g)}>+ Guardar</button>
                    <button className="chip-btn" onClick={() => handleDeleteGoal(g)}>Excluir</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {toast && <div className="toast show">{toast}</div>}

      <nav className="tabbar">
        <div className="tabbar-inner">
          <button className={"tab " + (tab === "inicio" ? "active" : "")} onClick={() => setTab("inicio")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
            </svg>
            Início
          </button>
          <button className={"tab " + (tab === "add" ? "active" : "")} onClick={() => setTab("add")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" />
            </svg>
            Adicionar
          </button>
          <button className={"tab " + (tab === "metas" ? "active" : "")} onClick={() => setTab("metas")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" />
            </svg>
            Metas
          </button>
          <button className={"tab " + (tab === "dados" ? "active" : "")} onClick={() => setTab("dados")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19V5M4 19h16" /><path d="M8 16v-4M12 16V8M16 16v-7" />
            </svg>
            Dados
          </button>
        </div>
      </nav>
    </div>
  );
}

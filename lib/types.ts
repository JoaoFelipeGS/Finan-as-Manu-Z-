export type Pessoa = "João" | "Manuela";
export type TipoLancamento = "receita" | "despesa";
export type TipoDespesa = "Compartilhada" | "Individual";

export interface Entry {
  id: string;
  data: string; // AAAA-MM-DD
  tipo: TipoLancamento;
  descricao: string;
  categoria: string | null;
  pessoa: Pessoa;
  despesaTipo: TipoDespesa | null;
  percJoao: number | null; // 0-1, só quando despesaTipo === "Compartilhada"
  valor: number;
}

export interface Goal {
  id: string;
  nome: string;
  valorObjetivo: number;
  valorGuardado: number;
  dataLimite: string | null;
}

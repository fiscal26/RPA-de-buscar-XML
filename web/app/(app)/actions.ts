"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { lerPlanilha } from "@/lib/planilha";
import { cifrarSenha } from "@/lib/cripto";
import { normalizarCnpj } from "@/lib/cnpj";
import { IDS_TIPOS, MAX_DIAS_PERIODO } from "@/lib/xml";

/** Item da conferência. Vai e volta do navegador SEM a senha em texto: só a versão cifrada. */
export type ItemAgendamento = {
  cnpj: string;
  apelido: string;
  login: string;
  linha: number;
  senhaCifrada: string | null; // null = usa a senha já cadastrada
  cadastrada: boolean;
};

export type Previa = {
  erro?: string;
  ok?: string;
  agendamentoId?: string;
  itens?: ItemAgendamento[];
  erros?: string[];
  avisos?: string[];
  nomeArquivo?: string;
  orgId?: string;
  inicio?: string;
  fim?: string;
  tipos?: string[];
  executarEm?: string | null; // ISO; null = agora
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function conferirPeriodo(inicio: string, fim: string): string | null {
  if (!DATA.test(inicio) || !DATA.test(fim)) return "Informe as datas inicial e final.";
  if (fim < inicio) return "A data final é anterior à inicial.";
  const dias = (Date.parse(fim) - Date.parse(inicio)) / 86_400_000;
  if (dias > MAX_DIAS_PERIODO) return `Período maior que ${MAX_DIAS_PERIODO} dias: divida em mais agendamentos.`;
  const hoje = new Date().toISOString().slice(0, 10);
  if (inicio > hoje) return "O período começa no futuro: ainda não há notas para baixar.";
  return null;
}

/** "2026-10-20T08:00" digitado no horário de Brasília -> ISO em UTC. */
function horarioBrasilia(valor: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null;
  const data = new Date(`${valor}:00-03:00`);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

export async function prepararAgendamento(_: Previa | undefined, form: FormData): Promise<Previa> {
  const { supabase, perfil, admin } = await contexto();
  const orgId = admin ? String(form.get("org_id") ?? "") : perfil.org_id ?? "";
  if (!orgId) return { erro: "Escolha a organização." };

  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha a planilha das empresas (.xlsx ou .csv)." };
  const inicio = String(form.get("inicio") ?? "");
  const fim = String(form.get("fim") ?? "");
  const erroPeriodo = conferirPeriodo(inicio, fim);
  if (erroPeriodo) return { erro: erroPeriodo };
  const tipos = form.getAll("tipo").map(String).filter((t) => IDS_TIPOS.includes(t));
  if (!tipos.length) return { erro: "Marque ao menos um tipo de XML." };
  let executarEm: string | null = null;
  if (form.get("quando") === "agendar") {
    executarEm = horarioBrasilia(String(form.get("executar_em") ?? ""));
    if (!executarEm) return { erro: "Informe a data e a hora em que o robô deve começar." };
  }

  let leitura;
  try {
    leitura = await lerPlanilha(arquivo);
  } catch (e) {
    return { erro: `Não consegui ler a planilha: ${(e as Error).message}` };
  }
  if (!leitura.empresas.length) return { erro: "Nenhuma empresa válida na planilha.", erros: leitura.erros };

  const { data: existentes } = await supabase.from("xml_empresas").select("cnpj").eq("org_id", orgId);
  const cadastradas = new Set((existentes ?? []).map((e) => e.cnpj as string));

  const itens: ItemAgendamento[] = [];
  const erros = [...leitura.erros];
  try {
    for (const e of leitura.empresas) {
      const cadastrada = cadastradas.has(e.cnpj);
      if (!e.senha && !cadastrada) {
        erros.push(`Linha ${e.linha}: informe a senha do ATF de ${e.apelido} (empresa ainda não cadastrada)`);
        continue;
      }
      itens.push({
        cnpj: e.cnpj, apelido: e.apelido, login: e.login, linha: e.linha, cadastrada,
        senhaCifrada: e.senha ? cifrarSenha(e.senha) : null,
      });
    }
  } catch (e) {
    return { erro: (e as Error).message };
  }
  if (!itens.length) return { erro: "Nenhuma empresa pronta para agendar.", erros };
  return { itens, erros, avisos: leitura.avisos, nomeArquivo: arquivo.name, orgId, inicio, fim, tipos, executarEm };
}

export async function confirmarAgendamento(previa: Previa): Promise<Previa> {
  const { user, perfil, admin } = await contexto();
  const orgId = admin ? previa.orgId ?? "" : perfil.org_id ?? "";
  if (!orgId || !previa.itens?.length) return { erro: "Agendamento vazio." };
  // confere de novo no servidor (os dados vieram do navegador)
  const erroPeriodo = conferirPeriodo(previa.inicio ?? "", previa.fim ?? "");
  if (erroPeriodo) return { erro: erroPeriodo };
  const tipos = (previa.tipos ?? []).filter((t) => IDS_TIPOS.includes(t));
  if (!tipos.length) return { erro: "Marque ao menos um tipo de XML." };
  const executarEm = previa.executarEm && !Number.isNaN(Date.parse(previa.executarEm)) ? previa.executarEm : new Date().toISOString();

  const vistos = new Set<string>();
  const itens = previa.itens.flatMap((i) => {
    const { cnpj } = normalizarCnpj(i.cnpj);
    if (!cnpj || vistos.has(cnpj)) return [];
    vistos.add(cnpj);
    const senha = typeof i.senhaCifrada === "string" && /^v1:[A-Za-z0-9+/=]{100,2000}$/.test(i.senhaCifrada) ? i.senhaCifrada : null;
    return [{ cnpj, apelido: String(i.apelido ?? "").trim().slice(0, 60) || cnpj, login: String(i.login ?? "").trim().slice(0, 60), senha }];
  });

  // Gravação com a chave secreta: a organização já foi conferida pela sessão acima
  const db = clienteAdmin();
  const comSenha = itens.filter((i) => i.senha);
  if (comSenha.length) {
    const { error } = await db.from("xml_empresas").upsert(
      comSenha.map((i) => ({ org_id: orgId, cnpj: i.cnpj, apelido: i.apelido, login_atf: i.login, senha_cifrada: i.senha, atualizado_em: new Date().toISOString() })),
      { onConflict: "org_id,cnpj" },
    );
    if (error) return { erro: `Não consegui salvar as empresas: ${error.message}` };
  }
  for (const i of itens.filter((i) => !i.senha)) {
    await db.from("xml_empresas").update({ apelido: i.apelido, login_atf: i.login, atualizado_em: new Date().toISOString() })
      .eq("org_id", orgId).eq("cnpj", i.cnpj);
  }
  const { data: empresas } = await db.from("xml_empresas").select("id, cnpj").eq("org_id", orgId).in("cnpj", itens.map((i) => i.cnpj));
  const idPorCnpj = new Map((empresas ?? []).map((e) => [e.cnpj as string, e.id as string]));
  const prontos = itens.filter((i) => idPorCnpj.has(i.cnpj));
  if (!prontos.length) return { erro: "Nenhuma empresa com senha cadastrada." };

  const { data: ag, error } = await db.from("xml_agendamentos").insert({
    org_id: orgId, criado_por: user.id, nome_arquivo: (previa.nomeArquivo ?? "").slice(0, 200),
    data_inicio: previa.inicio, data_fim: previa.fim, tipos, executar_em: executarEm, total: prontos.length,
  }).select("id").single();
  if (error) return { erro: error.message };
  const { error: erroTarefas } = await db.from("xml_tarefas").insert(
    prontos.map((i) => ({ org_id: orgId, agendamento_id: ag.id, empresa_id: idPorCnpj.get(i.cnpj), cnpj: i.cnpj, apelido: i.apelido })),
  );
  if (erroTarefas) {
    await db.from("xml_agendamentos").delete().eq("id", ag.id);
    return { erro: erroTarefas.message };
  }
  revalidatePath("/agendamentos");
  revalidatePath("/empresas");
  return { ok: `Agendamento criado: ${prontos.length} empresa(s) na fila.`, agendamentoId: ag.id };
}

export async function cancelarAgendamento(id: string) {
  const { supabase } = await contexto();
  await supabase.rpc("xml_cancelar_agendamento", { p_id: id });
  revalidatePath(`/agendamentos/${id}`);
  revalidatePath("/agendamentos");
}

export async function removerEmpresa(form: FormData) {
  const { perfil, admin } = await contexto();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const consulta = clienteAdmin().from("xml_empresas").delete().eq("id", id);
  // gestor/usuário só remove empresas da própria organização
  await (admin ? consulta : consulta.eq("org_id", perfil.org_id ?? ""));
  revalidatePath("/empresas");
}

"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { lerPlanilha } from "@/lib/planilha";
import { cifrarSenha } from "@/lib/cripto";
import { normalizarDocumento, normalizarIe } from "@/lib/documentos";
import { IDS_TIPOS } from "@/lib/xml";

/** Empresa da conferência (sem senha nenhuma: as senhas vão à parte, cifradas, por login). */
export type ItemAgendamento = {
  ie: string; nome: string; cnpj: string; codigo: string; filial: string;
  login: string; tipos: string[]; linha: number; cadastrada: boolean;
};

/** Login do contador. Vai e volta do navegador SEM a senha em texto: só a versão cifrada. */
export type AcessoAgendamento = { login: string; senhaCifrada: string | null; cadastrado: boolean };

export type Previa = {
  erro?: string;
  ok?: string;
  agendamentoId?: string;
  itens?: ItemAgendamento[];
  acessos?: AcessoAgendamento[];
  erros?: string[];
  avisos?: string[];
  nomeArquivo?: string;
  orgId?: string;
  competencia?: string;       // aaaa-mm
  executarEm?: string | null; // ISO; null = agora
};

function conferirCompetencia(valor: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) return "Escolha a competência (mês e ano).";
  const hoje = new Date().toISOString().slice(0, 7);
  if (valor > hoje) return "A competência ainda não começou: não há notas para baixar.";
  if (valor < "2006-01") return "Competência anterior à NF-e.";
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
  const competencia = String(form.get("competencia") ?? "");
  const erroCompetencia = conferirCompetencia(competencia);
  if (erroCompetencia) return { erro: erroCompetencia };
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
  if (!leitura.empresas.length) return { erro: "Nenhuma empresa pronta na planilha.", erros: leitura.erros, avisos: leitura.avisos };

  const [{ data: empresasCad }, { data: acessosCad }] = await Promise.all([
    supabase.from("xml_empresas").select("ie").eq("org_id", orgId),
    supabase.from("xml_acessos").select("login").eq("org_id", orgId),
  ]);
  const iesCadastradas = new Set((empresasCad ?? []).map((e) => e.ie as string));
  const loginsCadastrados = new Set((acessosCad ?? []).map((a) => a.login as string));

  // uma senha por login: a primeira preenchida; senhas diferentes para o mesmo login viram aviso
  const senhas = new Map<string, string>();
  const avisos = [...leitura.avisos];
  for (const e of leitura.empresas) {
    if (!e.senha) continue;
    const ja = senhas.get(e.login);
    if (ja === undefined) senhas.set(e.login, e.senha);
    else if (ja !== e.senha) avisos.push(`Linha ${e.linha}: o login ${e.login} aparece com outra senha; vale a primeira da planilha`);
  }
  const erros = [...leitura.erros];
  const semSenha = new Set([...new Set(leitura.empresas.map((e) => e.login))].filter((l) => !senhas.has(l) && !loginsCadastrados.has(l)));
  for (const e of leitura.empresas.filter((e) => semSenha.has(e.login))) {
    erros.push(`Linha ${e.linha}: ${e.nome}: informe a SENHA do login ${e.login} (ainda não cadastrado)`);
  }
  const itens: ItemAgendamento[] = leitura.empresas.filter((e) => !semSenha.has(e.login)).map((e) => ({
    ie: e.ie, nome: e.nome, cnpj: e.cnpj, codigo: e.codigo, filial: e.filial, login: e.login, tipos: e.tipos,
    linha: e.linha, cadastrada: iesCadastradas.has(e.ie),
  }));
  if (!itens.length) return { erro: "Nenhuma empresa pronta para agendar.", erros, avisos };

  let acessos: AcessoAgendamento[];
  try {
    acessos = [...new Set(itens.map((i) => i.login))].map((login) => {
      const senha = senhas.get(login);
      return { login, senhaCifrada: senha ? cifrarSenha(senha) : null, cadastrado: loginsCadastrados.has(login) };
    });
  } catch (e) {
    return { erro: (e as Error).message };
  }
  return { itens, acessos, erros, avisos, nomeArquivo: arquivo.name, orgId, competencia, executarEm };
}

const SENHA_CIFRADA = /^v1:[A-Za-z0-9+/=]{100,2000}$/;

export async function confirmarAgendamento(previa: Previa): Promise<Previa> {
  const { user, perfil, admin } = await contexto();
  const orgId = admin ? previa.orgId ?? "" : perfil.org_id ?? "";
  if (!orgId || !previa.itens?.length) return { erro: "Agendamento vazio." };
  // confere de novo no servidor (os dados vieram do navegador)
  const competencia = previa.competencia ?? "";
  const erroCompetencia = conferirCompetencia(competencia);
  if (erroCompetencia) return { erro: erroCompetencia };
  const executarEm = previa.executarEm && !Number.isNaN(Date.parse(previa.executarEm)) ? previa.executarEm : new Date().toISOString();
  const agora = new Date().toISOString();
  const db = clienteAdmin(); // chave secreta: a organização já foi conferida pela sessão acima

  // 1) logins do contador (senha nova substitui a guardada)
  const acessos = (previa.acessos ?? []).flatMap((a) => {
    const login = String(a.login ?? "").trim().slice(0, 60);
    return login ? [{ login, senha: typeof a.senhaCifrada === "string" && SENHA_CIFRADA.test(a.senhaCifrada) ? a.senhaCifrada : null }] : [];
  });
  const comSenha = acessos.filter((a) => a.senha);
  if (comSenha.length) {
    const { error } = await db.from("xml_acessos").upsert(
      comSenha.map((a) => ({ org_id: orgId, login: a.login, senha_cifrada: a.senha, atualizado_em: agora })),
      { onConflict: "org_id,login" },
    );
    if (error) return { erro: `Não consegui salvar os logins do ATF: ${error.message}` };
  }
  const { data: acessosDb } = await db.from("xml_acessos").select("id, login").eq("org_id", orgId);
  const acessoPorLogin = new Map((acessosDb ?? []).map((a) => [a.login as string, a.id as string]));

  // 2) empresas (uma por IE)
  const vistas = new Set<string>();
  const empresas = previa.itens.flatMap((i) => {
    const { ie } = normalizarIe(i.ie);
    const acessoId = acessoPorLogin.get(String(i.login ?? "").trim());
    if (!ie || vistas.has(ie) || !acessoId) return [];
    vistas.add(ie);
    const tipos = (i.tipos ?? []).filter((t) => IDS_TIPOS.includes(t));
    if (!tipos.length) return [];
    return [{
      org_id: orgId, ie, cnpj: normalizarDocumento(i.cnpj).doc, codigo: String(i.codigo ?? "").slice(0, 20),
      filial: String(i.filial ?? "").slice(0, 20), nome: String(i.nome ?? "").trim().slice(0, 60) || ie,
      acesso_id: acessoId, tipos, atualizado_em: agora,
    }];
  });
  if (!empresas.length) return { erro: "Nenhuma empresa com login do ATF cadastrado." };
  const { data: empresasDb, error: erroEmpresas } = await db.from("xml_empresas")
    .upsert(empresas, { onConflict: "org_id,ie" }).select("id, ie");
  if (erroEmpresas) return { erro: `Não consegui salvar as empresas: ${erroEmpresas.message}` };
  const idPorIe = new Map((empresasDb ?? []).map((e) => [e.ie as string, e.id as string]));

  // 3) agendamento e uma tarefa por empresa
  const { data: ag, error } = await db.from("xml_agendamentos").insert({
    org_id: orgId, criado_por: user.id, nome_arquivo: (previa.nomeArquivo ?? "").slice(0, 200),
    competencia: `${competencia}-01`, executar_em: executarEm, total: empresas.length,
  }).select("id").single();
  if (error) return { erro: error.message };
  const { error: erroTarefas } = await db.from("xml_tarefas").insert(empresas.map((e) => ({
    org_id: orgId, agendamento_id: ag.id, empresa_id: idPorIe.get(e.ie), ie: e.ie, nome: e.nome, codigo: e.codigo, tipos: e.tipos,
  })));
  if (erroTarefas) {
    await db.from("xml_agendamentos").delete().eq("id", ag.id);
    return { erro: erroTarefas.message };
  }
  revalidatePath("/painel/agendamentos");
  revalidatePath("/painel/empresas");
  return { ok: `Agendamento criado: ${empresas.length} empresa(s) na fila.`, agendamentoId: ag.id };
}

export async function cancelarAgendamento(id: string) {
  const { supabase } = await contexto();
  await supabase.rpc("xml_cancelar_agendamento", { p_id: id });
  revalidatePath(`/painel/agendamentos/${id}`);
  revalidatePath("/painel/agendamentos");
}

export async function removerEmpresa(form: FormData) {
  const { perfil, admin } = await contexto();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const consulta = clienteAdmin().from("xml_empresas").delete().eq("id", id);
  // gestor/usuário só remove empresas da própria organização
  await (admin ? consulta : consulta.eq("org_id", perfil.org_id ?? ""));
  revalidatePath("/painel/empresas");
}

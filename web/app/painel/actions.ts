"use server";

import { erroPeriodo, competenciasPeriodo } from "@/lib/periodo";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { lerPlanilha } from "@/lib/planilha";
import { cifrarSenha } from "@/lib/cripto";
import { normalizarDocumento, normalizarIe } from "@/lib/documentos";
import { IDS_TIPOS } from "@/lib/xml";
import { carregarSelecaoSefaz } from "@/lib/cadastro-sefaz";
import { corrigirNome } from "@/lib/nomes";

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
  fonte?: "cadastro"; empresasIds?: string[];
  agendamentoId?: string; agendamentoIds?: string[]; competenciasAgendadas?: string[];
  itens?: ItemAgendamento[];
  acessos?: AcessoAgendamento[];
  erros?: string[];
  avisos?: string[];
  nomeArquivo?: string;
  orgId?: string;
  competenciaFinal?: string; competencia?: string;       // aaaa-mm
  executarEm?: string | null; // ISO; null = agora
};


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
  const competencia = String(form.get("competencia") ?? "");
  const competenciaFinal = String(form.get("competencia_final") || competencia);
  const erroCompetencia = erroPeriodo(competencia, competenciaFinal, "2006-01");
  if (erroCompetencia) return { erro: erroCompetencia };
  let executarEm: string | null = null;
  if (form.get("quando") === "agendar") {
    executarEm = horarioBrasilia(String(form.get("executar_em") ?? ""));
    if (!executarEm) return { erro: "Informe a data e a hora em que o robô deve começar." };
  }

  if(form.get("fonte")==="cadastro") {
    const ids=[...new Set(form.getAll("empresas").map(String))];
    const selecao=await carregarSelecaoSefaz(supabase,orgId,ids);
    if("erro" in selecao)return {erro:selecao.erro};
    const {empresas,logins:porId}=selecao;
    return {fonte:"cadastro",empresasIds:ids,itens:empresas.map((e)=>({ie:e.ie,nome:e.nome,cnpj:e.cnpj,codigo:e.codigo,filial:e.filial,login:porId.get(e.acesso_id!)!,tipos:e.tipos,linha:0,cadastrada:true})),acessos:[...new Set(empresas.map((e)=>porId.get(e.acesso_id!)!))].map((login)=>({login,senhaCifrada:null,cadastrado:true})),erros:[],avisos:[],nomeArquivo:"Empresas cadastradas",orgId,competencia,competenciaFinal,executarEm};
  }
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha a planilha das empresas (.xlsx ou .csv)." };
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
  return { itens, acessos, erros, avisos, nomeArquivo: arquivo.name, orgId, competencia, competenciaFinal, executarEm };
}

const SENHA_CIFRADA = /^v1:[A-Za-z0-9+/=]{100,2000}$/;

export async function confirmarAgendamento(previa: Previa): Promise<Previa> {
  const { user, perfil, admin, supabase } = await contexto();
  const orgId = admin ? previa.orgId ?? "" : perfil.org_id ?? "";
  if (!orgId || !previa.itens?.length) return { erro: "Agendamento vazio." };
  // confere de novo no servidor (os dados vieram do navegador)
  const competencia = previa.competencia ?? "";
  const competenciaFinal = previa.competenciaFinal || competencia;
  const erroCompetencia = erroPeriodo(competencia, competenciaFinal, "2006-01");
  if (erroCompetencia) return { erro: erroCompetencia };
  const executarEm = previa.executarEm && !Number.isNaN(Date.parse(previa.executarEm)) ? previa.executarEm : new Date().toISOString();
  const agora = new Date().toISOString();
  const db = clienteAdmin(); // chave secreta: a organização já foi conferida pela sessão acima

  if(previa.fonte === "cadastro") {
    const selecao=await carregarSelecaoSefaz(supabase,orgId,previa.empresasIds??[]);
    if("erro" in selecao)return {erro:selecao.erro};
    // Relê os cadastros na confirmação; não recria empresas removidas nem altera acessos.
    const r=await db.rpc("xml_agendar_periodo",{p_org:orgId,p_criado_por:user.id,p_inicio:`${competencia}-01`,p_fim:`${competenciaFinal}-01`,p_executar:executarEm,p_origem:"sefaz",p_nome:"Empresas cadastradas",p_empresas:selecao.empresas.map((e)=>({id:e.id,tipos:e.tipos})),p_certificado:null});
    if(r.error)return {erro:"Não foi possível agendar as empresas selecionadas. Confira os cadastros e tente novamente."};
    const ids=(r.data??[]) as string[];
    revalidatePath("/painel/agendamentos");
    return {ok:`${ids.length} competências agendadas para ${selecao.empresas.length} empresas.`,agendamentoId:ids[0],agendamentoIds:ids,competenciasAgendadas:competenciasPeriodo(competencia,competenciaFinal)};
  }

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

  // 2) empresas (uma por IE). Nome renomeado no portal (nome_fixo) vale mais que o da planilha.
  const { data: fixos } = await db.from("xml_empresas").select("ie, nome").eq("org_id", orgId).eq("nome_fixo", true);
  const nomeFixo = new Map((fixos ?? []).map((f) => [f.ie as string, f.nome as string]));
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
      filial: String(i.filial ?? "").slice(0, 20), nome: nomeFixo.get(ie) ?? (corrigirNome(String(i.nome ?? "")) || ie),
      acesso_id: acessoId, tipos, atualizado_em: agora,
    }];
  });
  if (!empresas.length) return { erro: "Nenhuma empresa com login do ATF cadastrado." };
  const { data: empresasDb, error: erroEmpresas } = await db.from("xml_empresas")
    .upsert(empresas, { onConflict: "org_id,ie" }).select("id, ie");
  if (erroEmpresas) return { erro: `Não consegui salvar as empresas: ${erroEmpresas.message}` };
  const idPorIe = new Map((empresasDb ?? []).map((e) => [e.ie as string, e.id as string]));

  // 3) agendamento e uma tarefa por empresa
  const { data: ids, error } = await db.rpc("xml_agendar_periodo", {
    p_org: orgId, p_criado_por: user.id, p_inicio: `${competencia}-01`, p_fim: `${competenciaFinal}-01`,
    p_executar: executarEm, p_origem: "sefaz", p_nome: previa.nomeArquivo ?? "",
    p_empresas: empresas.map((e) => ({ id: idPorIe.get(e.ie), tipos: e.tipos })),
    p_certificado: null,
  });
  if (error) return { erro: `Não consegui agendar o período: ${error.message}` };
  const agendamentoIds = (ids ?? []) as string[];
  revalidatePath("/painel/agendamentos");
  revalidatePath("/painel/empresas");
  return { ok: `${agendamentoIds.length} ${agendamentoIds.length === 1 ? "competência agendada" : "competências agendadas"} para ${empresas.length} ${empresas.length === 1 ? "empresa" : "empresas"}.`, agendamentoId: agendamentoIds[0], agendamentoIds, competenciasAgendadas: competenciasPeriodo(competencia, competenciaFinal) };
}

export async function cancelarAgendamento(id: string) {
  const { supabase } = await contexto();
  await supabase.rpc("xml_cancelar_agendamento", { p_id: id });
  revalidatePath(`/painel/agendamentos/${id}`);
  revalidatePath("/painel/agendamentos");
}

export type EstadoRenomear = { ok?: string; erro?: string } | undefined;

/** Renomeia a empresa no portal. O nome fica fixo: a planilha seguinte não volta o nome antigo. */
export async function renomearEmpresa(_: EstadoRenomear, form: FormData): Promise<EstadoRenomear> {
  const { supabase } = await contexto();
  const id = String(form.get("id") ?? "");
  const nome = corrigirNome(String(form.get("nome") ?? ""));
  if (!nome) return { erro: "Informe o nome." };
  if (form.get("origem") === "nfse") {
    const { data: empresaNfse } = await supabase.from("xml_nfse_empresas").select("id").eq("id", id).maybeSingle();
    if (!empresaNfse) return { erro: "Empresa não encontrada." };
    const db = clienteAdmin();
    const { error } = await db.from("xml_nfse_empresas").update({ nome, nome_fixo: true, atualizado_em: new Date().toISOString() }).eq("id", id);
    if (error) return { erro: `Não consegui renomear: ${error.message}` };
    await db.from("xml_tarefas").update({ nome }).eq("nfse_empresa_id", id).in("status", ["pendente", "processando"]);
    revalidatePath("/painel", "layout");
    return { ok: nome };
  }
  // a leitura com a sessão do usuário confere se a empresa é do escritório dele (ou se é o administrador)
  const { data: empresa } = await supabase.from("xml_empresas").select("id, org_id, ie").eq("id", id).maybeSingle();
  if (!empresa) return { erro: "Empresa não encontrada." };
  const db = clienteAdmin();
  const { error } = await db.from("xml_empresas").update({ nome, nome_fixo: true, atualizado_em: new Date().toISOString() }).eq("id", id);
  if (error) return { erro: `Não consegui renomear: ${error.message}` };
  // o que ainda vai rodar e o monitoramento MEI passam a usar o nome novo
  await Promise.all([
    db.from("xml_tarefas").update({ nome }).eq("empresa_id", id).in("status", ["pendente", "processando"]),
    db.from("xml_mei_meses").update({ nome }).eq("org_id", empresa.org_id).eq("ie", empresa.ie),
  ]);
  revalidatePath("/painel", "layout");
  return { ok: nome };
}

export async function removerEmpresa(form: FormData) {
  const { perfil, admin } = await contexto();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const tabela = form.get("origem") === "nfse" ? "xml_nfse_empresas" : "xml_empresas";
  const consulta = clienteAdmin().from(tabela).delete().eq("id", id);
  // gestor/usuário só remove empresas da própria organização
  await (admin ? consulta : consulta.eq("org_id", perfil.org_id ?? ""));
  revalidatePath("/painel/empresas");
}

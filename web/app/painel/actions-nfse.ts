"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { lerPlanilhaNfse } from "@/lib/planilha-nfse";
import { cifrarArquivo, cifrarSenha } from "@/lib/cripto";
import { TAMANHO_MAXIMO, lerCertificado } from "@/lib/certificado";
import { cnpjValido, formatarDocumento, soDigitos } from "@/lib/documentos";
import { IDS_TIPOS_NFSE } from "@/lib/xml";
import { corrigirNome } from "@/lib/nomes";

/** Situação do certificado A1 de uma empresa: o dela, o da matriz (mesma raiz do CNPJ) ou nenhum. */
export type SituacaoCertificado = "proprio" | "matriz" | "vencido" | "falta";

export type ItemNfse = {
  cnpj: string; nome: string; codigo: string; tipos: string[]; linha: number; cadastrada: boolean;
  certificado: SituacaoCertificado;
};

export type PreviaNfse = {
  erro?: string; ok?: string; agendamentoId?: string;
  itens?: ItemNfse[]; erros?: string[]; avisos?: string[];
  nomeArquivo?: string; orgId?: string; competencia?: string; executarEm?: string | null;
};

type Certificado = { cnpj: string; validade: string | null };

/** O certificado que o robô vai usar para o CNPJ (o mesmo critério de xml_nfse_pegar_lote). */
function certificadoPara(cnpj: string, certificados: Certificado[]): SituacaoCertificado {
  const daRaiz = certificados.filter((c) => c.cnpj.slice(0, 8) === cnpj.slice(0, 8));
  if (!daRaiz.length) return "falta";
  const escolhido = daRaiz.find((c) => c.cnpj === cnpj) ?? daRaiz.find((c) => c.cnpj.slice(8, 12) === "0001") ?? daRaiz[0];
  if (escolhido.validade && Date.parse(escolhido.validade) < Date.now()) return "vencido";
  return escolhido.cnpj === cnpj ? "proprio" : "matriz";
}

function conferirCompetencia(valor: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) return "Escolha a competência (mês e ano).";
  if (valor > new Date().toISOString().slice(0, 7)) return "A competência ainda não começou: não há notas para baixar.";
  if (valor < "2023-01") return "O Portal Nacional da NFS-e só tem notas a partir de 2023.";
  return null;
}

function horarioBrasilia(valor: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null;
  const data = new Date(`${valor}:00-03:00`);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

export async function prepararAgendamentoNfse(_: PreviaNfse | undefined, form: FormData): Promise<PreviaNfse> {
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
    leitura = await lerPlanilhaNfse(arquivo);
  } catch (e) {
    return { erro: `Não consegui ler a planilha: ${(e as Error).message}` };
  }
  if (!leitura.empresas.length) return { erro: "Nenhuma empresa pronta na planilha.", erros: leitura.erros, avisos: leitura.avisos };

  const [{ data: empresasCad }, { data: certificados }] = await Promise.all([
    supabase.from("xml_nfse_empresas").select("cnpj").eq("org_id", orgId),
    supabase.from("xml_nfse_certificados").select("cnpj, validade").eq("org_id", orgId),
  ]);
  const cadastradas = new Set((empresasCad ?? []).map((e) => e.cnpj as string));
  const itens: ItemNfse[] = leitura.empresas.map((e) => ({
    ...e, cadastrada: cadastradas.has(e.cnpj), certificado: certificadoPara(e.cnpj, (certificados ?? []) as Certificado[]),
  }));
  const avisos = [...leitura.avisos];
  const sem = itens.filter((i) => i.certificado === "falta" || i.certificado === "vencido");
  if (sem.length) {
    avisos.push(`${sem.length} ${sem.length === 1 ? "empresa está" : "empresas estão"} sem certificado A1 válido (nem da matriz): `
      + `${sem.slice(0, 5).map((i) => i.nome).join(", ")}${sem.length > 5 ? "…" : ""}. Envie em Certificados antes da hora marcada.`);
  }
  return { itens, erros: leitura.erros, avisos, nomeArquivo: arquivo.name, orgId, competencia, executarEm };
}

export async function confirmarAgendamentoNfse(previa: PreviaNfse): Promise<PreviaNfse> {
  const { user, perfil, admin } = await contexto();
  const orgId = admin ? previa.orgId ?? "" : perfil.org_id ?? "";
  if (!orgId || !previa.itens?.length) return { erro: "Agendamento vazio." };
  const competencia = previa.competencia ?? "";
  const erroCompetencia = conferirCompetencia(competencia);
  if (erroCompetencia) return { erro: erroCompetencia };
  const executarEm = previa.executarEm && !Number.isNaN(Date.parse(previa.executarEm)) ? previa.executarEm : new Date().toISOString();
  const agora = new Date().toISOString();
  const db = clienteAdmin(); // a organização já foi conferida pela sessão acima

  // empresas (uma por CNPJ); o nome renomeado no portal vale mais que o da planilha
  const { data: fixos } = await db.from("xml_nfse_empresas").select("cnpj, nome").eq("org_id", orgId).eq("nome_fixo", true);
  const nomeFixo = new Map((fixos ?? []).map((f) => [f.cnpj as string, f.nome as string]));
  const vistas = new Set<string>();
  const empresas = previa.itens.flatMap((i) => {
    const cnpj = soDigitos(String(i.cnpj ?? ""));
    if (!cnpjValido(cnpj) || vistas.has(cnpj)) return [];
    vistas.add(cnpj);
    const tipos = (i.tipos ?? []).filter((t) => IDS_TIPOS_NFSE.includes(t));
    if (!tipos.some((t) => t === "nfse_emitidas" || t === "nfse_recebidas")) return [];
    return [{
      org_id: orgId, cnpj, codigo: String(i.codigo ?? "").slice(0, 20),
      nome: nomeFixo.get(cnpj) ?? (corrigirNome(String(i.nome ?? "")) || formatarDocumento(cnpj)), tipos, atualizado_em: agora,
    }];
  });
  if (!empresas.length) return { erro: "Nenhuma empresa válida para agendar." };
  const { data: empresasDb, error: erroEmpresas } = await db.from("xml_nfse_empresas")
    .upsert(empresas, { onConflict: "org_id,cnpj" }).select("id, cnpj");
  if (erroEmpresas) return { erro: `Não consegui salvar as empresas: ${erroEmpresas.message}` };
  const idPorCnpj = new Map((empresasDb ?? []).map((e) => [e.cnpj as string, e.id as string]));

  const { data: ag, error } = await db.from("xml_agendamentos").insert({
    org_id: orgId, criado_por: user.id, nome_arquivo: (previa.nomeArquivo ?? "").slice(0, 200), origem: "nfse",
    competencia: `${competencia}-01`, executar_em: executarEm, total: empresas.length,
  }).select("id").single();
  if (error) return { erro: error.message };
  const { error: erroTarefas } = await db.from("xml_tarefas").insert(empresas.map((e) => ({
    org_id: orgId, agendamento_id: ag.id, nfse_empresa_id: idPorCnpj.get(e.cnpj), ie: e.cnpj, nome: e.nome, codigo: e.codigo, tipos: e.tipos,
  })));
  if (erroTarefas) {
    await db.from("xml_agendamentos").delete().eq("id", ag.id);
    return { erro: erroTarefas.message };
  }
  revalidatePath("/painel/agendamentos");
  return { ok: `Agendamento criado: ${empresas.length} ${empresas.length === 1 ? "empresa" : "empresas"} na fila.`, agendamentoId: ag.id };
}

// ------------------------------------------------------------------ certificados A1

export type EstadoCertificado = { ok?: string; erro?: string } | undefined;

/** Recebe o .pfx e a senha, confere que a senha abre o arquivo, lê CNPJ e validade e grava os dois cifrados
 *  para o robô. O arquivo e a senha em texto só existem na memória do servidor durante este envio. */
export async function salvarCertificado(_: EstadoCertificado, form: FormData): Promise<EstadoCertificado> {
  const { user, perfil, admin } = await contexto();
  const orgId = admin ? String(form.get("org_id") ?? "") : perfil.org_id ?? "";
  if (!orgId) return { erro: "Escolha a organização." };
  const arquivo = form.get("arquivo");
  const senha = String(form.get("senha") ?? "");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha o arquivo do certificado (.pfx ou .p12)." };
  if (arquivo.size > TAMANHO_MAXIMO) return { erro: "Arquivo grande demais para um certificado A1." };
  if (!/\.(pfx|p12)$/i.test(arquivo.name)) return { erro: "O certificado A1 é um arquivo .pfx ou .p12." };
  if (!senha) return { erro: "Informe a senha do certificado." };
  const pfx = Buffer.from(await arquivo.arrayBuffer());

  let dados;
  try {
    dados = lerCertificado(pfx, senha);
  } catch (e) {
    return { erro: (e as Error).message };
  }
  const informado = soDigitos(String(form.get("cnpj") ?? ""));
  const cnpj = dados.cnpj || informado;
  if (!cnpjValido(cnpj)) return { erro: "Não achei o CNPJ no certificado. Informe o CNPJ da empresa no campo abaixo do arquivo." };
  if (dados.cnpj && informado && informado !== dados.cnpj) {
    return { erro: `Este certificado é do CNPJ ${formatarDocumento(dados.cnpj)}, não do ${formatarDocumento(informado)}.` };
  }
  if (dados.validade && Date.parse(dados.validade) < Date.now()) {
    return { erro: `Este certificado venceu em ${new Date(dados.validade).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })}.` };
  }
  let pfxCifrado: string, senhaCifrada: string;
  try {
    pfxCifrado = cifrarArquivo(pfx);
    senhaCifrada = cifrarSenha(senha);
  } catch (e) {
    return { erro: (e as Error).message };
  }
  const { error } = await clienteAdmin().from("xml_nfse_certificados").upsert({
    org_id: orgId, cnpj, nome: dados.nome, validade: dados.validade, pfx_cifrado: pfxCifrado, senha_cifrada: senhaCifrada,
    criado_por: user.id, atualizado_em: new Date().toISOString(),
  }, { onConflict: "org_id,cnpj" });
  if (error) return { erro: `Não consegui salvar o certificado: ${error.message}` };
  revalidatePath("/painel/certificados");
  return { ok: `Certificado de ${dados.nome || formatarDocumento(cnpj)} (${formatarDocumento(cnpj)}) salvo.` };
}

export async function removerCertificado(form: FormData) {
  const { perfil, admin } = await contexto();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const consulta = clienteAdmin().from("xml_nfse_certificados").delete().eq("id", id);
  await (admin ? consulta : consulta.eq("org_id", perfil.org_id ?? ""));
  revalidatePath("/painel/certificados");
}

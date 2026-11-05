"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { lerPlanilhaNfse } from "@/lib/planilha-nfse";
import { cifrarArquivo, cifrarSenha } from "@/lib/cripto";
import { TAMANHO_MAXIMO, lerCertificado } from "@/lib/certificado";
import { cnpjValido, cpfValido, formatarDocumento, soDigitos } from "@/lib/documentos";
import { IDS_TIPOS_NFSE } from "@/lib/xml";
import { certificadoDoCnpj, usaProcuracao } from "@/lib/nfse";
import { corrigirNome } from "@/lib/nomes";
import { empresasComCnpj } from "@/lib/cadastro-nfse";

/** Situação do certificado A1 de uma empresa: o dela, o da matriz (mesma raiz do CNPJ) ou nenhum. */
export type SituacaoCertificado = "proprio" | "matriz" | "escritorio" | "vencido" | "falta";

export type ItemNfse = {
  cnpj: string; nome: string; codigo: string; tipos: string[]; linha: number; cadastrada: boolean;
  certificado: SituacaoCertificado;
};

export type PreviaNfse = {
  erro?: string; ok?: string; agendamentoId?: string;
  itens?: ItemNfse[]; erros?: string[]; avisos?: string[];
  nomeArquivo?: string; orgId?: string; competencia?: string; executarEm?: string | null;
  certificadoId?: string | null; certificadoNome?: string;
};

type Certificado = { cnpj: string; validade: string | null; procurador?: boolean };

/** O certificado que o robô vai usar para o CNPJ (o mesmo critério de xml_nfse_pegar_lote). */
function certificadoPara(cnpj: string, certificados: Certificado[]): SituacaoCertificado {
  const escolhido = certificadoDoCnpj(cnpj, certificados);
  if (!escolhido) return "falta";
  if (escolhido.validade && Date.parse(escolhido.validade) < Date.now()) return "vencido";
  if (escolhido.cnpj === cnpj) return "proprio";
  return usaProcuracao(cnpj, escolhido) ? "escritorio" : "matriz";
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
  const doCadastro = form.get("fonte") === "cadastro";
  const arquivo = form.get("arquivo");
  if (!doCadastro && (!(arquivo instanceof File) || arquivo.size === 0)) return { erro: "Escolha a planilha das empresas (.xlsx ou .csv)." };
  const competencia = String(form.get("competencia") ?? "");
  const erroCompetencia = conferirCompetencia(competencia);
  if (erroCompetencia) return { erro: erroCompetencia };
  let executarEm: string | null = null;
  if (form.get("quando") === "agendar") {
    executarEm = horarioBrasilia(String(form.get("executar_em") ?? ""));
    if (!executarEm) return { erro: "Informe a data e a hora em que o robô deve começar." };
  }

  let leitura;
  if (doCadastro) {
    const escolhidas = new Set(form.getAll("cnpjs").map((c) => soDigitos(String(c))));
    if (!escolhidas.size) return { erro: "Marque as empresas que o robô deve rodar (ou Selecionar todas)." };
    const empresas = (await empresasComCnpj(supabase, orgId)).filter((e) => escolhidas.has(e.cnpj))
      .map((e, i) => ({ cnpj: e.cnpj, nome: e.nome, codigo: e.codigo, tipos: e.tipos, linha: i + 1 }));
    if (!empresas.length) return { erro: "Nenhuma das empresas marcadas está no cadastro desta organização." };
    leitura = { empresas, erros: [] as string[], avisos: [] as string[] };
  } else {
    try {
      leitura = await lerPlanilhaNfse(arquivo as File);
    } catch (e) {
      return { erro: `Não consegui ler a planilha: ${(e as Error).message}` };
    }
  }
  if (!leitura.empresas.length) return { erro: "Nenhuma empresa pronta na planilha.", erros: leitura.erros, avisos: leitura.avisos };

  const [{ data: empresasCad }, { data: certificados }] = await Promise.all([
    supabase.from("xml_nfse_empresas").select("cnpj").eq("org_id", orgId),
    supabase.from("xml_nfse_certificados").select("id, nome, cnpj, validade, procurador").eq("org_id", orgId),
  ]);
  // certificado escolhido no agendamento (vazio = automático: o da empresa, o da matriz ou o do escritório)
  const certificadoId = String(form.get("certificado_id") ?? "") || null;
  const escolhido = certificadoId ? (certificados ?? []).find((c) => c.id === certificadoId) : undefined;
  if (certificadoId && !escolhido) return { erro: "O certificado escolhido não é desta organização. Escolha outro." };
  const usados = (escolhido ? [escolhido] : certificados ?? []) as Certificado[];
  const cadastradas = new Set((empresasCad ?? []).map((e) => e.cnpj as string));
  const itens: ItemNfse[] = leitura.empresas.map((e) => ({
    ...e, cadastrada: cadastradas.has(e.cnpj), certificado: certificadoPara(e.cnpj, usados),
  }));
  const avisos = [...leitura.avisos];
  const sem = itens.filter((i) => i.certificado === "falta" || i.certificado === "vencido");
  if (sem.length) {
    avisos.push(escolhido
      ? `O certificado escolhido não serve para ${sem.length} ${sem.length === 1 ? "empresa" : "empresas"} (não é dela, nem da matriz, nem do escritório com procuração, ou está vencido): `
        + `${sem.slice(0, 5).map((i) => i.nome).join(", ")}${sem.length > 5 ? "…" : ""}. Escolha "Automático" ou outro certificado.`
      : `${sem.length} ${sem.length === 1 ? "empresa está" : "empresas estão"} sem certificado A1 válido (nem da matriz, nem do escritório): `
      + `${sem.slice(0, 5).map((i) => i.nome).join(", ")}${sem.length > 5 ? "…" : ""}. Envie em Certificados antes da hora marcada.`);
  }  const porProcuracao = itens.filter((i) => i.certificado === "escritorio");
  if (porProcuracao.length) {
    avisos.push(`${porProcuracao.length} ${porProcuracao.length === 1 ? "empresa vai" : "empresas vão"} usar o certificado do escritório. `
      + "Confira se cada uma deu procuração eletrônica ao escritório no e-CAC (com acesso à NFS-e).");
  }

  const nomeArquivo = doCadastro ? "Empresas cadastradas" : (arquivo as File).name;
  const certificadoNome = escolhido ? `${escolhido.nome || formatarDocumento(escolhido.cnpj)} (${formatarDocumento(escolhido.cnpj)})` : undefined;
  return { itens, erros: leitura.erros, avisos, nomeArquivo, orgId, competencia, executarEm, certificadoId, certificadoNome };
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
  if (previa.certificadoId) {  // a prévia volta do navegador: o certificado tem de ser desta organização
    const { data: cert } = await db.from("xml_nfse_certificados").select("id").eq("id", previa.certificadoId).eq("org_id", orgId).maybeSingle();
    if (!cert) return { erro: "O certificado escolhido não é desta organização. Leia a planilha de novo." };
  }

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
    ...(previa.certificadoId ? { certificado_id: previa.certificadoId } : {}),
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
  // certificado do escritório (procuração eletrônica): e-CNPJ do escritório ou e-CPF do contador
  const procurador = form.get("procurador") === "on";
  const informado = soDigitos(String(form.get("cnpj") ?? ""));
  const cnpj = dados.cnpj || dados.cpf || informado;
  if (dados.cpf && !procurador) {
    return { erro: "Este é um e-CPF. Ele só serve como certificado do escritório: marque \"Certificado do escritório (procuração)\"." };
  }
  if (!(cnpjValido(cnpj) || (procurador && cpfValido(cnpj)))) {
    return { erro: "Não achei o CNPJ no certificado. Informe o CNPJ da empresa no campo abaixo do arquivo." };
  }
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
    org_id: orgId, cnpj, nome: dados.nome, validade: dados.validade, pfx_cifrado: pfxCifrado, senha_cifrada: senhaCifrada, procurador,
    criado_por: user.id, atualizado_em: new Date().toISOString(),
  }, { onConflict: "org_id,cnpj" });
  if (error) return { erro: `Não consegui salvar o certificado: ${error.message}` };
  revalidatePath("/painel/certificados");
  return { ok: `Certificado ${procurador ? "do escritório " : ""}de ${dados.nome || formatarDocumento(cnpj)} (${formatarDocumento(cnpj)}) salvo.`
    + (procurador ? " Ele vale para todas as empresas que deram procuração ao escritório no e-CAC." : "") };
}

export async function removerCertificado(form: FormData) {
  const { perfil, admin } = await contexto();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const consulta = clienteAdmin().from("xml_nfse_certificados").delete().eq("id", id);
  await (admin ? consulta : consulta.eq("org_id", perfil.org_id ?? ""));
  revalidatePath("/painel/certificados");
}

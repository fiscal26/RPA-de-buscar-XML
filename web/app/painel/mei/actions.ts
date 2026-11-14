"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { verificarAlertasMei } from "@/lib/alertas-mei";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { carregarMeis } from "@/lib/mei-dados";
import { cnpjValido } from "@/lib/documentos";

export type EstadoAjuste = { erro?: string; ok?: string } | undefined;

/** "1.234,56", "1234.56" ou "-300" em número. */
function valorBR(texto: string): number | null {
  let t = texto.replace(/[R$\s]/g, "");
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");   // 1.234,56
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");   // 1.250 (milhar)
  else t = t.replace(/,/g, "");                                          // 1234.56
  const v = Number(t);
  return isFinite(v) && v !== 0 ? Math.round(v * 100) / 100 : null;
}

/** O usuário enxerga esse MEI? (as regras de leitura do banco decidem; a gravação vai com a chave secreta) */
async function conferirAcesso(org: string, ie: string, competencia: string) {
  const { supabase } = await contexto();
  const { meis, erros } = await carregarMeis(supabase, Number(competencia.slice(0, 4)), ie);
  if (erros.length) return false;
  const m = meis.find((m) => m.org === org);
  return !!m && (!m.cadastro || (competencia >= m.cadastro.inicio_mei.slice(0, 7)
    && (!m.cadastro.fim_mei || competencia <= m.cadastro.fim_mei.slice(0, 7))));
}

export async function salvarCadastroMei(_: EstadoAjuste, form: FormData): Promise<EstadoAjuste> {
  const { supabase, perfil, admin, user } = await contexto();
  if (!admin && perfil.papel !== "gestor") return { erro: "Somente gestor ou administrador pode alterar o cadastro MEI." };
  const org = admin ? String(form.get("org") ?? "") : perfil.org_id ?? "";
  const cnpj = String(form.get("cnpj") ?? "");
  if (!org || !cnpjValido(cnpj)) return { erro: "Escolha uma empresa cadastrada com CNPJ válido." };
  const [{ data: n }, { data: s }] = await Promise.all([
    supabase.from("xml_nfse_empresas").select("nome").eq("org_id", org).eq("cnpj", cnpj).limit(1),
    supabase.from("xml_empresas").select("nome").eq("org_id", org).eq("cnpj", cnpj).limit(1),
  ]);
  const nome = n?.[0]?.nome || s?.[0]?.nome;
  if (!nome) return { erro: "Empresa não encontrada neste escritório." };
  const abertura = String(form.get("abertura") ?? "");
  const inicio = String(form.get("inicio") ?? ""), fim = String(form.get("fim") ?? "");
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(abertura) && !Number.isNaN(Date.parse(abertura))
    && new Date(abertura + "T12:00:00Z").toISOString().slice(0, 10) === abertura;
  const mesValido = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
  if (!dataValida || abertura > hoje || !mesValido(inicio) || inicio < abertura.slice(0, 7) || inicio > hoje.slice(0, 7)
    || (fim && (!mesValido(fim) || fim < inicio))) return { erro: "Confira a data de abertura e o período de enquadramento MEI." };
  const { error } = await clienteAdmin().from("xml_mei_cadastros").upsert({ org_id: org, cnpj, nome,
    ativo: form.get("ativo") === "on", inicio_atividade: abertura, inicio_mei: inicio + "-01", fim_mei: fim ? fim + "-01" : null,
    atualizado_por: user.id, atualizado_em: new Date().toISOString() }, { onConflict: "org_id,cnpj" });
  if (error) return { erro: "Não foi possível salvar o cadastro MEI. Confira se a atualização do banco foi aplicada." };
  revalidatePath("/painel/empresas"); revalidatePath("/painel/mei", "layout");
  return { ok: "Cadastro MEI salvo. O monitoramento já considera este período; os valores serão atualizados na próxima consulta." };
}

export type EstadoReprocessar = { erro?: string; ok?: string; agendamentos?: string[] } | undefined;
export async function reprocessarMei(_: EstadoReprocessar, form: FormData): Promise<EstadoReprocessar> {
  const { supabase } = await contexto();
  const { data, error } = await supabase.rpc("xml_mei_reprocessar", { p_org: String(form.get("org") ?? ""),
    p_documento: String(form.get("documento") ?? ""), p_competencia: `${form.get("competencia")}-01` });
  if (error) return { erro: error.message.includes("xml_mei_reprocessar")
    ? "A atualização MEI/NFS-e precisa ser aplicada no banco antes de reprocessar." : error.message };
  revalidatePath("/painel/agendamentos");
  return { ok: data.existente ? "Já existe uma consulta na fila para esta empresa e competência. Acompanhe abaixo."
    : "Reprocessamento enviado à fila do robô. Os últimos valores válidos serão mantidos até a conclusão.", agendamentos: data.agendamentos };
}

export async function adicionarAjuste(_: EstadoAjuste, form: FormData): Promise<EstadoAjuste> {
  const { user } = await contexto();
  const org = String(form.get("org") ?? ""), ie = String(form.get("ie") ?? "");
  const competencia = String(form.get("competencia") ?? "");
  const tipo = String(form.get("tipo") ?? "");
  const descricao = String(form.get("descricao") ?? "").trim();
  const valor = valorBR(String(form.get("valor") ?? ""));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) return { erro: "Escolha o mês." };
  if (tipo !== "receita" && tipo !== "compra") return { erro: "Escolha se é receita ou compra." };
  if (!descricao || descricao.length > 120) return { erro: "Descreva o lançamento (até 120 caracteres)." };
  if (valor === null || Math.abs(valor) > 10_000_000) return { erro: "Informe o valor, por exemplo 1.250,00 (negativo para corrigir para menos)." };
  if (!(await conferirAcesso(org, ie, competencia))) return { erro: "MEI não encontrado, dados incompletos ou competência fora do período cadastrado." };
  const { error } = await clienteAdmin().from("xml_mei_ajustes").insert({
    org_id: org, ie, competencia: `${competencia}-01`, tipo, descricao, valor, criado_por: user.id,
  });
  if (error) return { erro: `Não foi possível salvar: ${error.message}` };
  revalidatePath("/painel/mei", "layout");
  // o lançamento pode levar o MEI a um novo nível: avisa a equipe sem esperar o agendamento diário
  after(() => verificarAlertasMei({ org, ie }).catch((e) => console.error("alertas MEI:", e)));
  return { ok: "Lançamento incluído." };
}

export async function removerAjuste(form: FormData) {
  const id = String(form.get("id") ?? "");
  const { supabase } = await contexto();
  // só remove o que o usuário consegue ler (mesma organização ou administrador)
  const { data } = await supabase.from("xml_mei_ajustes").select("id").eq("id", id).maybeSingle();
  if (!data) return;
  await clienteAdmin().from("xml_mei_ajustes").delete().eq("id", id);
  revalidatePath("/painel/mei", "layout");
}

/** Pausa o acompanhamento, sem apagar faturamento, ajustes ou alertas anteriores. */
export async function naoEhMei(form: FormData) {
  const { perfil, admin } = await contexto();
  if (!admin && perfil.papel !== "gestor") return;
  const ie = String(form.get("ie") ?? "");
  const org = admin ? String(form.get("org") ?? "") : perfil.org_id ?? "";
  if (!/^(\d{9}|\d{14})$/.test(ie) || !org) return;
  const db = clienteAdmin();
  if (ie.length === 14) {
    const { error } = await db.from("xml_mei_cadastros").update({ ativo: false, atualizado_em: new Date().toISOString() })
      .eq("org_id", org).eq("cnpj", ie);
    if (error) throw new Error("Não foi possível pausar o acompanhamento MEI.");
  }
  const { data: empresas } = await db.from("xml_empresas").select("id, tipos").eq("org_id", org).eq(ie.length === 14 ? "cnpj" : "ie", ie);
  for (const e of empresas ?? []) {
    await db.from("xml_empresas").update({ tipos: (e.tipos as string[]).filter((t) => t !== "mei") }).eq("id", e.id);
  }
  revalidatePath("/painel/mei", "layout");
  revalidatePath("/painel/empresas");
  redirect("/painel/mei");
}

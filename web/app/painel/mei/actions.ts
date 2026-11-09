"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { verificarAlertasMei } from "@/lib/alertas-mei";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";

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
async function conferirAcesso(org: string, ie: string) {
  const { supabase } = await contexto();
  const [{ data: emp }, { data: mes }] = await Promise.all([
    supabase.from("xml_empresas").select("org_id").eq("org_id", org).eq("ie", ie).limit(1),
    supabase.from("xml_mei_meses").select("org_id").eq("org_id", org).eq("ie", ie).limit(1),
  ]);
  return !!(emp?.length || mes?.length);
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
  if (!(await conferirAcesso(org, ie))) return { erro: "MEI não encontrado." };
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

/** "Não é MEI": tira a empresa do Monitoramento MEI do escritório. Apaga o faturamento lido do ATF, os lançamentos
 *  e os alertas dela e desmarca o serviço MEI no cadastro (o robô não consulta mais o dossiê dela). Gestor ou admin. */
export async function naoEhMei(form: FormData) {
  const { perfil, admin } = await contexto();
  if (!admin && perfil.papel !== "gestor") return;
  const ie = String(form.get("ie") ?? "");
  const org = admin ? String(form.get("org") ?? "") : perfil.org_id ?? "";
  if (!/^\d{9}$/.test(ie) || !org) return;
  const db = clienteAdmin();
  await Promise.all([
    db.from("xml_mei_meses").delete().eq("org_id", org).eq("ie", ie),
    db.from("xml_mei_ajustes").delete().eq("org_id", org).eq("ie", ie),
    db.from("xml_mei_alertas").delete().eq("org_id", org).eq("ie", ie),
  ]);
  const { data: empresas } = await db.from("xml_empresas").select("id, tipos").eq("org_id", org).eq("ie", ie);
  for (const e of empresas ?? []) {
    await db.from("xml_empresas").update({ tipos: (e.tipos as string[]).filter((t) => t !== "mei") }).eq("id", e.id);
  }
  revalidatePath("/painel/mei", "layout");
  redirect("/painel/mei");
}

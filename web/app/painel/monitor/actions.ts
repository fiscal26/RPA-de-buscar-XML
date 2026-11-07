"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { empresasComCnpj } from "@/lib/cadastro-nfse";
import { soDigitos } from "@/lib/documentos";
import { horaBR } from "@/lib/monitor";

export type EstadoMonitor = { ok?: string; erro?: string } | undefined;

/** Coloca no Monitor Fiscal as empresas marcadas (só gestor ou administrador). A primeira consulta sai já. */
export async function adicionarMonitor(_: EstadoMonitor, form: FormData): Promise<EstadoMonitor> {
  const { supabase, user, perfil, admin } = await contexto();
  if (!admin && perfil.papel !== "gestor") return { erro: "Só o gestor do escritório inclui empresas no monitoramento." };
  const orgId = admin ? String(form.get("org_id") ?? "") : perfil.org_id ?? "";
  if (!orgId) return { erro: "Escolha a organização." };
  const marcadas = new Set(form.getAll("cnpjs").map((c) => soDigitos(String(c))));
  if (!marcadas.size) return { erro: "Marque as empresas que entram no monitoramento (ou Selecionar todas)." };
  const empresas = (await empresasComCnpj(supabase, orgId)).filter((e) => marcadas.has(e.cnpj));
  if (!empresas.length) return { erro: "Nenhuma das empresas marcadas está no cadastro desta organização." };
  const ciencia = form.get("ciencia") === "on";
  const { error } = await clienteAdmin().from("xml_nfe_monitor").upsert(
    empresas.map((e) => ({ org_id: orgId, cnpj: e.cnpj, nome: e.nome, codigo: e.codigo, ciencia, ativo: true,
      adicionado_por: user.id, proxima_consulta: new Date().toISOString() })),
    { onConflict: "org_id,cnpj", ignoreDuplicates: false },
  );
  if (error) return { erro: `Não consegui incluir: ${error.message}` };
  revalidatePath("/painel/monitor");
  return { ok: `${empresas.length} ${empresas.length === 1 ? "empresa incluída" : "empresas incluídas"} no monitoramento. A primeira consulta sai assim que o robô pegar a fila.` };
}

/** Tira a empresa do monitoramento (as notas já encontradas continuam no histórico). */
export async function removerMonitor(form: FormData) {
  const { perfil, admin } = await contexto();
  if (!admin && perfil.papel !== "gestor") return;
  const id = String(form.get("id") ?? "");
  const consulta = clienteAdmin().from("xml_nfe_monitor").delete().eq("id", id);
  await (admin ? consulta : consulta.eq("org_id", perfil.org_id ?? ""));
  revalidatePath("/painel/monitor");
}

/** Antecipa a consulta (o banco respeita 1 hora desde a última, regra do Ambiente Nacional). */
export async function consultarAgora(form: FormData) {
  const { supabase } = await contexto();
  await supabase.rpc("xml_nfe_consultar_agora", { p_id: String(form.get("id") ?? "") });
  revalidatePath("/painel/monitor");
}

/** Horário da consulta diária do escritório (só gestor ou administrador). As próximas consultas mudam na hora. */
export async function salvarHorario(_: EstadoMonitor, form: FormData): Promise<EstadoMonitor> {
  const { perfil, admin } = await contexto();
  if (!admin && perfil.papel !== "gestor") return { erro: "Só o gestor do escritório muda o horário." };
  const hora = String(form.get("hora") ?? "");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { erro: "Escolha um horário válido." };
  const db = clienteAdmin();
  // o horário é do escritório de quem salva; o administrador sem escritório próprio ajusta todos
  let orgs = perfil.org_id ? [perfil.org_id] : [];
  if (!orgs.length && admin) orgs = ((await db.from("organizacoes").select("id")).data ?? []).map((o) => o.id as string);
  if (!orgs.length) return { erro: "Seu acesso não está ligado a um escritório." };
  const { error } = await db.from("organizacoes").update({ monitor_hora: hora }).in("id", orgs);
  if (error) {
    return { erro: /monitor_hora/.test(error.message)
      ? "O banco ainda não tem o campo do horário: rode o schema.sql de novo no Supabase."
      : `Não consegui salvar: ${error.message}` };
  }
  for (const id of orgs) await db.rpc("xml_nfe_reagendar", { p_org: id });
  revalidatePath("/painel/monitor");
  return { ok: `Pronto: a consulta diária passa a ser às ${horaBR(hora)}.` };
}

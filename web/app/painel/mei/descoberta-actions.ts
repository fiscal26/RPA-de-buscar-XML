"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { schemaMeiAusente } from "@/lib/mei-descoberta";
import { erroPeriodo } from "@/lib/periodo";

export type EstadoDescoberta =
  | {
      erro?: string;
      ok?: string;
      lote?: string;
      resultados?: {
        cnpj: string;
        erro?: string;
        consultas?: { id: string; competencia: string; origem: string }[];
      }[];
    }
  | undefined;
function atualizar() {
  revalidatePath("/painel/mei", "layout");
  revalidatePath("/painel/empresas");
}
function erroBanco(erro: { code?: string; message?: string } | null) {
  return schemaMeiAusente(erro)
    ? "O banco precisa receber a atualização do cadastro MEI. Avise o administrador."
    : erro?.message || "Não foi possível concluir a operação.";
}
async function gestor(org: string) {
  const ctx = await contexto();
  if (
    !ctx.admin &&
    (ctx.perfil.papel !== "gestor" || ctx.perfil.org_id !== org)
  )
    throw new Error(
      "Somente gestor ou administrador do escritório pode alterar o acompanhamento.",
    );
  return ctx;
}
export async function criarLoteMei(
  _: EstadoDescoberta,
  form: FormData,
): Promise<EstadoDescoberta> {
  const org = String(form.get("org") ?? "");
  try {
    const { user } = await gestor(org);
    const r = await clienteAdmin().rpc("xml_mei_enfileirar", {
      p_org: org,
      p_cnpj: null,
      p_origem: "manual",
      p_usuario: user.id,
    });
    if (r.error) return { erro: erroBanco(r.error) };
    atualizar();
    return {
      lote: r.data,
      ok: "Verificação iniciada. Você pode fechar esta página e acompanhar o resultado depois.",
    };
  } catch (e) {
    return {
      erro: e instanceof Error ? e.message : "Não foi possível iniciar o lote.",
    };
  }
}
export async function confirmarLoteMei(
  _: EstadoDescoberta,
  form: FormData,
): Promise<EstadoDescoberta> {
  const org = String(form.get("org") ?? "");
  try {
    const { user, supabase } = await gestor(org);
    const lote = String(form.get("lote") ?? "");
    const { data } = await supabase
      .from("xml_mei_sincronizacoes")
      .select("id")
      .eq("id", lote)
      .eq("org_id", org)
      .maybeSingle();
    if (!data) return { erro: "Lote não encontrado neste escritório." };
    const r = await clienteAdmin().rpc("xml_mei_confirmar_lote", {
      p_lote: lote,
      p_cnpjs: form.getAll("cnpjs").map(String),
      p_usuario: user.id,
    });
    if (r.error) return { erro: erroBanco(r.error) };
    atualizar();
    return {
      ok: `Empresas incluídas: ${r.data?.incluido ?? 0}. ${r.data?.revisar ?? 0} precisam de revisão; ${r.data?.dispensado ?? 0} pausas/exclusões respeitadas. O histórico fiscal disponível já pode ser consultado.`,
    };
  } catch (e) {
    return {
      erro:
        e instanceof Error ? e.message : "Não foi possível confirmar o lote.",
    };
  }
}
export async function decidirAcompanhamentoMei(
  _: EstadoDescoberta,
  form: FormData,
): Promise<EstadoDescoberta> {
  const org = String(form.get("org") ?? "");
  try {
    const { user } = await gestor(org);
    const fim = String(form.get("fim") ?? "");
    if (fim && !/^\d{4}-(0[1-9]|1[0-2])$/.test(fim))
      return { erro: "Escolha o último mês MEI válido." };
    const versao = String(form.get("versao") ?? "");
    const r = await clienteAdmin().rpc("xml_mei_decidir", {
      p_org: org,
      p_cnpj: String(form.get("cnpj") ?? ""),
      p_usuario: user.id,
      p_acao: String(form.get("acao") ?? ""),
      p_fim: fim ? `${fim}-01` : null,
      p_motivo: String(form.get("motivo") ?? ""),
      p_versao: versao ? Number(versao) : null,
    });
    if (r.error) return { erro: erroBanco(r.error) };
    atualizar();
    return {
      ok: "Decisão registrada. O histórico foi preservado e será respeitado nas próximas verificações.",
    };
  } catch (e) {
    return {
      erro:
        e instanceof Error
          ? e.message
          : "Não foi possível registrar a decisão.",
    };
  }
}
export async function atualizarFaturamentoLoteMei(
  _: EstadoDescoberta,
  form: FormData,
): Promise<EstadoDescoberta> {
  const org = String(form.get("org") ?? ""),
    inicio = String(form.get("competencia") ?? ""),
    fim = String(form.get("competencia_final") || inicio);
  const erro = erroPeriodo(inicio, fim, "2018-01");
  if (erro) return { erro };
  try {
    const { supabase } = await gestor(org);
    const cnpjs = [...new Set(form.getAll("cnpjs").map(String))];
    if (!cnpjs.length)
      return {
        erro: "Selecione as empresas que devem atualizar o faturamento.",
      };
    const r = await supabase.rpc("xml_mei_faturamento_lote", {
      p_org: org,
      p_cnpjs: cnpjs,
      p_inicio: `${inicio}-01`,
      p_fim: `${fim}-01`,
    });
    if (r.error) return { erro: erroBanco(r.error) };
    atualizar();
    revalidatePath("/painel/agendamentos");
    return {
      ok: "Pedidos processados. Confira as consultas e eventuais pendências de acesso abaixo.",
      resultados: r.data,
    };
  } catch (e) {
    return {
      erro:
        e instanceof Error
          ? e.message
          : "Não foi possível atualizar o faturamento.",
    };
  }
}

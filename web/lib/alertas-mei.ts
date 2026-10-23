import "server-only";
import { clienteAdmin } from "@/lib/supabase/admin";
import { carregarMeis, type MeiCarteira } from "@/lib/mei-dados";
import { type Medida, type Nivel, pct, reais } from "@/lib/mei";
import { enderecoSite, enviarEmail, emailConfigurado } from "@/lib/email";
import { formatarIe } from "@/lib/documentos";

// do mais leve ao mais grave: chegar a um nível conta os anteriores como avisados (não manda "80%" depois de "passou")
const ORDEM: Nivel[] = ["ritmo", "atencao", "excedeu", "excedeu20"];
const MEDIDAS = [{ id: "faturamento", nome: "faturamento" }, { id: "compras", nome: "compras" }] as const;

function textos(m: MeiCarteira, medida: (typeof MEDIDAS)[number], d: Medida) {
  const quem = `${m.nome || "MEI"} (IE ${formatarIe(m.ie)})`;
  const base = `${reais(d.total)} de ${reais(d.limite, 0)} no ano (${pct(d.pct)} do limite de ${medida.nome}).`;
  const proj = `Mantida a média mensal, chega a ${reais(d.projecao, 0)} em dezembro (${pct(d.projecao / d.limite)}).`;
  switch (d.nivel) {
    case "ritmo": return { assunto: `Alerta MEI: ${m.nome} no ritmo de passar do limite de ${medida.nome}`,
      paragrafos: [`${quem} ainda está abaixo de 80% do limite de ${medida.nome}, mas no ritmo de ultrapassá-lo até dezembro.`, base, proj] };
    case "atencao": return { assunto: `Alerta MEI: ${m.nome} chegou a ${pct(d.pct)} do limite de ${medida.nome}`,
      paragrafos: [`${quem} já usou ${pct(d.pct)} do limite de ${medida.nome} do ano.`, base, proj] };
    case "excedeu": return { assunto: `Alerta MEI: ${m.nome} passou do limite de ${medida.nome}`,
      paragrafos: [`${quem} passou do limite de ${medida.nome} em até 20%.`, base,
        medida.id === "faturamento" ? "Com excesso de até 20%, o desenquadramento vale a partir de 1º de janeiro do ano seguinte e o excesso é tributado."
          : "Verifique o desenquadramento do SIMEI."] };
    default: return { assunto: `Alerta MEI: ${m.nome} passou mais de 20% do limite de ${medida.nome}`,
      paragrafos: [`${quem} passou mais de 20% do limite de ${medida.nome}.`, base,
        medida.id === "faturamento" ? "Com excesso acima de 20%, o desenquadramento retroage a janeiro (ou ao início da atividade)."
          : "Verifique o desenquadramento do SIMEI."] };
  }
}

/**
 * Confere os MEIs e manda o alerta de limite (no ritmo de passar, 80%, passou, passou 20%) para todas as pessoas
 * ativas do escritório que não desligaram os alertas. Cada nível sai uma vez por ano, por MEI e por medida.
 * Com `filtro`, só aquele MEI (depois de um lançamento manual). Roda todo dia pelo agendamento da Vercel.
 */
export async function verificarAlertasMei(filtro?: { org: string; ie: string }) {
  const resumo = { verificados: 0, enviados: 0, erros: [] as string[] };
  if (!emailConfigurado()) return { ...resumo, erros: ["envio de e-mail não configurado"] };
  const db = clienteAdmin();
  const hoje = new Date();
  // em janeiro e fevereiro o robô ainda traz meses do ano anterior
  const anos = hoje.getMonth() < 2 ? [hoje.getFullYear(), hoje.getFullYear() - 1] : [hoje.getFullYear()];
  const site = await enderecoSite();
  const pessoas = new Map<string, { email: string; nome: string }[]>();

  for (const ano of anos) {
    const { meis, erros } = await carregarMeis(db, ano, filtro?.ie);
    resumo.erros.push(...erros);
    for (const m of meis) {
      if (filtro && m.org !== filtro.org) continue;
      resumo.verificados++;
      for (const medida of MEDIDAS) {
        const d = m.ano[medida.id];
        const i = ORDEM.indexOf(d.nivel);
        if (i < 0) continue;
        // reserva os níveis até o atual; só quem conseguiu reservar o nível atual envia (nada sai em dobro)
        const { data: novos, error } = await db.from("xml_mei_alertas").upsert(
          ORDEM.slice(0, i + 1).map((nivel) => ({ org_id: m.org, ie: m.ie, ano, medida: medida.id, nivel,
            percentual: Math.round(d.pct * 10000) / 100 })),
          { onConflict: "org_id,ie,ano,medida,nivel", ignoreDuplicates: true },
        ).select("nivel");
        if (error) { resumo.erros.push(error.message); continue; }
        if (!novos?.some((n) => n.nivel === d.nivel)) continue;

        if (!pessoas.has(m.org)) {
          const { data, error: e } = await db.from("perfis").select("email, nome")
            .eq("org_id", m.org).eq("ativo", true).eq("alertas_mei", true);
          if (e) resumo.erros.push(e.message);
          pessoas.set(m.org, (data ?? []).filter((p) => p.email));
        }
        const t = textos(m, medida, d);
        let enviados = 0;
        for (const p of pessoas.get(m.org)!) {
          const falha = await enviarEmail({
            para: { email: p.email, nome: p.nome }, assunto: t.assunto, titulo: "Monitoramento de Faturamento MEI",
            paragrafos: t.paragrafos, botao: { texto: "Ver no painel", url: `${site}/painel/mei/${m.ie}?ano=${ano}` },
            rodape: "Você recebe este alerta por fazer parte da equipe do escritório. Para não receber mais, desligue em Meu perfil.",
          });
          if (falha) resumo.erros.push(falha); else enviados++;
        }
        resumo.enviados += enviados;
        await db.from("xml_mei_alertas").update({ destinatarios: enviados })
          .match({ org_id: m.org, ie: m.ie, ano, medida: medida.id, nivel: d.nivel });
      }
    }
  }
  return resumo;
}

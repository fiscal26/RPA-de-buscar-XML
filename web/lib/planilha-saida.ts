import "server-only";
import writeXlsxFile from "write-excel-file/node";
import { TIPOS, TIPOS_NFSE } from "@/lib/xml";

type Supabase = Awaited<ReturnType<typeof import("@/lib/supabase/server").criarCliente>>;
type Celula = { value: string; type: StringConstructor; fontWeight?: "bold"; backgroundColor?: string; textColor?: string };

// Cabeçalhos iguais aos das planilhas modelo: o arquivo baixado pode ser enviado de novo como está.
const COLUNAS_SEFAZ = ["ATIVA", "ID", "ID_FILIAL", "CNPJ", "INSCRICAO ESTADUAL", "NOME FANTASIA", "LOGIN", "SENHA"];
const SERVICOS_SEFAZ: Record<string, string> = {
  nfe_saida: "NF-e Saida", nfe_entrada: "NF-e Entrada", nfce: "NFC-e", cte: "CT-e", faturas: "Download Faturas",
  extrato: "Extrato de Pagamentos", omissao: "Omissão e Inadimplência", certidao: "Certidão de Débitos",
  cartao: "Conferência Cartão de Credito", mei: "Dossiê MEI",
};
const COLUNAS_NFSE = ["ATIVA", "ID", "CNPJ", "NOME FANTASIA"];

const texto = (v: unknown): Celula => ({ value: String(v ?? ""), type: String });
const cabecalho = (v: string): Celula => ({ value: v, type: String, fontWeight: "bold", backgroundColor: "#127622", textColor: "#FFFFFF" });
const marca = (sim: boolean) => texto(sim ? "X" : "");

type TarefaSefaz = {
  ie: string; nome: string; codigo: string; tipos: string[];
  xml_empresas?: { cnpj: string; filial: string; xml_acessos?: { login: string } | null } | null;
};
type TarefaNfse = { ie: string; nome: string; codigo: string; tipos: string[] };

/** A planilha de um agendamento, montada de novo com o que ele teve (empresas, logins e serviços marcados).
 *  A SENHA vai em branco: o portal nunca guarda a planilha enviada, só as senhas cifradas, e a senha em branco
 *  faz o portal usar a que já está guardada para aquele login. A leitura usa a sessão do usuário: cada
 *  escritório só baixa os próprios agendamentos. */
export async function planilhaDoAgendamento(supabase: Supabase, id: string): Promise<{ nome: string; arquivo: Buffer } | null> {
  const { data: ag } = await supabase.from("xml_agendamentos").select("id, competencia, origem").eq("id", id).maybeSingle();
  if (!ag) return null;
  const competencia = String(ag.competencia).slice(0, 7);

  if (ag.origem === "nfse") {
    const { data } = await supabase.from("xml_tarefas").select("ie, nome, codigo, tipos")
      .eq("agendamento_id", id).order("criado_em");
    const linhas = ((data ?? []) as TarefaNfse[]).map((t) => [
      texto("X"), texto(t.codigo), texto(t.ie), texto(t.nome), ...TIPOS_NFSE.map((s) => marca(t.tipos.includes(s.id))),
    ]);
    const cab = [...COLUNAS_NFSE, "NFS-e Emitidas", "NFS-e Recebidas", "PDF (DANFSe)", "Relatório de Retenções"].map(cabecalho);
    const arquivo = await writeXlsxFile([cab, ...linhas], {
      sheet: "Listagem das empresas", stickyRowsCount: 1,
      columns: [10, 14, 22, 50, 16, 17, 15, 22].map((width) => ({ width })),
    }).toBuffer();
    return { nome: `planilha_nfse_${competencia}.xlsx`, arquivo };
  }

  const { data } = await supabase.from("xml_tarefas")
    .select("ie, nome, codigo, tipos, xml_empresas(cnpj, filial, xml_acessos(login))")
    .eq("agendamento_id", id).order("criado_em");
  const linhas = ((data ?? []) as unknown as TarefaSefaz[]).map((t) => [
    texto("X"), texto(t.codigo), texto(t.xml_empresas?.filial), texto(t.xml_empresas?.cnpj), texto(t.ie), texto(t.nome),
    texto(t.xml_empresas?.xml_acessos?.login), texto(""),  // SENHA em branco: já está guardada no portal
    ...TIPOS.map((s) => marca(t.tipos.includes(s.id))),
  ]);
  const cab = [...COLUNAS_SEFAZ, ...TIPOS.map((s) => SERVICOS_SEFAZ[s.id] ?? s.nome)].map(cabecalho);
  const arquivo = await writeXlsxFile([cab, ...linhas], {
    sheet: "Listagem das empresas", stickyRowsCount: 1,
    columns: [10, 10, 12, 20, 20, 40, 14, 12, ...TIPOS.map(() => 14)].map((width) => ({ width })),
  }).toBuffer();
  return { nome: `planilha_sefaz_${competencia}.xlsx`, arquivo };
}

export function respostaPlanilha({ nome, arquivo }: { nome: string; arquivo: Buffer }) {
  return new Response(new Uint8Array(arquivo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

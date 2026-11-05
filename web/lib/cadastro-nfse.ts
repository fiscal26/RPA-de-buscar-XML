import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cnpjValido, formatarDocumento, soDigitos } from "@/lib/documentos";
import { IDS_TIPOS_NFSE } from "@/lib/xml";

export type EmpresaCadastro = { org_id: string; cnpj: string; nome: string; codigo: string; tipos: string[] };

/** As empresas com CNPJ já cadastradas: as da NFS-e (com os serviços escolhidos) e as da SEFAZ (com todos os
 *  serviços da NFS-e), uma por CNPJ em cada escritório, em ordem de nome. */
export async function empresasComCnpj(supabase: SupabaseClient, orgId?: string): Promise<EmpresaCadastro[]> {
  let nfse = supabase.from("xml_nfse_empresas").select("org_id, cnpj, nome, codigo, tipos").order("nome");
  let sefaz = supabase.from("xml_empresas").select("org_id, cnpj, nome, codigo").order("nome");
  if (orgId) {
    nfse = nfse.eq("org_id", orgId);
    sefaz = sefaz.eq("org_id", orgId);
  }
  const [{ data: n }, { data: s }] = await Promise.all([nfse, sefaz]);
  const vistas = new Set<string>();
  const lista: EmpresaCadastro[] = [];
  for (const e of [...(n ?? []), ...(s ?? []).map((x) => ({ ...x, tipos: IDS_TIPOS_NFSE }))]) {
    const cnpj = soDigitos(String(e.cnpj ?? ""));
    const chave = `${e.org_id}:${cnpj}`;
    if (!cnpjValido(cnpj) || vistas.has(chave)) continue;
    vistas.add(chave);
    const tipos = ((e.tipos as string[] | null) ?? IDS_TIPOS_NFSE).filter((t) => IDS_TIPOS_NFSE.includes(t));
    lista.push({ org_id: String(e.org_id), cnpj, nome: String(e.nome ?? "") || formatarDocumento(cnpj),
      codigo: String(e.codigo ?? ""), tipos: tipos.length ? tipos : IDS_TIPOS_NFSE });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

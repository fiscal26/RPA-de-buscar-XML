import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDS_TIPOS } from "./xml";

type EmpresaSefaz = {
  id: string;
  ie: string;
  nome: string;
  cnpj: string;
  codigo: string;
  filial: string;
  tipos: string[];
  acesso_id: string | null;
};
export async function carregarSelecaoSefaz(
  supabase: SupabaseClient,
  org: string,
  informados: string[],
) {
  const ids = [...new Set(informados)];
  if (!ids.length || ids.length > 2000)
    return { erro: "Selecione entre 1 e 2000 empresas cadastradas." } as const;
  const escritorio = await supabase
    .from("organizacoes")
    .select("id")
    .eq("id", org)
    .eq("ativo", true)
    .maybeSingle();
  if (escritorio.error || !escritorio.data)
    return { erro: "Escritório indisponível ou sem acesso." } as const;
  const empresas: EmpresaSefaz[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await supabase
      .from("xml_empresas")
      .select("id,ie,nome,cnpj,codigo,filial,tipos,acesso_id")
      .eq("org_id", org)
      .in("id", ids.slice(i, i + 100));
    if (r.error)
      return {
        erro: "Não foi possível carregar as empresas selecionadas.",
      } as const;
    empresas.push(...(r.data ?? []));
  }
  if (empresas.length !== ids.length)
    return {
      erro: "Uma empresa selecionada não existe neste escritório. Atualize a lista.",
    } as const;
  const logins = new Map<string, string>();
  const acessos = [
    ...new Set(empresas.flatMap((e) => (e.acesso_id ? [e.acesso_id] : []))),
  ];
  for (let i = 0; i < acessos.length; i += 100) {
    const r = await supabase
      .from("xml_acessos")
      .select("id,login")
      .eq("org_id", org)
      .in("id", acessos.slice(i, i + 100));
    if (r.error)
      return { erro: "Não foi possível conferir os logins ATF." } as const;
    for (const a of r.data ?? []) logins.set(a.id, a.login);
  }
  if (
    empresas.some(
      (e) =>
        !e.acesso_id ||
        !logins.has(e.acesso_id) ||
        !e.tipos?.length ||
        e.tipos.some((t) => !IDS_TIPOS.includes(t)),
    )
  )
    return {
      erro: "Há empresa sem login ATF ou serviços válidos. Confira o cadastro antes de agendar.",
    } as const;
  return { empresas, logins };
}

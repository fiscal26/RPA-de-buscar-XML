"use server";

import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { cnpjValido } from "@/lib/documentos";
import { buscarDadosCnpj, type ResultadoCnpj } from "@/lib/cnpja";

export async function consultarCnpj(org: string, cnpj: string, forcar = false): Promise<ResultadoCnpj> {
  const { supabase, perfil, admin } = await contexto();
  if (!admin && (perfil.papel !== "gestor" || perfil.org_id !== org)) return { erro: "Somente gestor ou administrador pode consultar o cadastro MEI." };
  if (!cnpjValido(cnpj)) return { erro: "CNPJ inválido." };
  // Só consulta empresas cadastradas e visíveis para esta sessão. Nunca aceita URL do navegador.
  const [nfse, sefaz] = await Promise.all([
    supabase.from("xml_nfse_empresas").select("id").eq("org_id", org).eq("cnpj", cnpj).limit(1),
    supabase.from("xml_empresas").select("id").eq("org_id", org).eq("cnpj", cnpj).limit(1),
  ]);
  if (!(nfse.data?.length || sefaz.data?.length)) return { erro: "Empresa não encontrada neste escritório." };
  const db = clienteAdmin();
  return buscarDadosCnpj(cnpj, forcar === true, {
    reservar: async (doc, atualizar) => {
      const { data, error } = await db.rpc("xml_cnpja_reservar", { p_cnpj: doc, p_forcar: atualizar });
      if (error) throw error;
      return data;
    },
    finalizar: async (doc, token, dados, bloqueio) => {
      const { data, error } = await db.rpc("xml_cnpja_finalizar", { p_cnpj: doc, p_token: token, p_dados: dados, p_bloqueio: bloqueio });
      if (error) throw error;
      return data === true;
    },
  });
}

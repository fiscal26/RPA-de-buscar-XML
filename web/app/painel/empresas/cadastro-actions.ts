"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { cifrarSenha } from "@/lib/cripto";
import { validarCadastroIndividual } from "@/lib/cadastro-individual";
import { buscarDadosCnpj, type ResultadoCnpj } from "@/lib/cnpja";
import { cnpjValido } from "@/lib/documentos";

export type EstadoCadastroEmpresa =
  | {
      erro?: string;
      ok?: string;
      origem?: "sefaz" | "nfse";
      id?: string;
      org?: string;
      cnpj?: string;
    }
  | undefined;
async function escritorio(informado: string) {
  const ctx = await contexto();
  const org = informado || ctx.perfil.org_id || "";
  if (!org || (!ctx.admin && ctx.perfil.org_id !== org))
    return {
      erro: "Escolha um escritório ao qual você tenha acesso.",
    } as const;
  const r = await ctx.supabase
    .from("organizacoes")
    .select("id")
    .eq("id", org)
    .eq("ativo", true)
    .maybeSingle();
  if (r.error || !r.data)
    return { erro: "Escritório indisponível ou sem acesso." } as const;
  return { ...ctx, org };
}

/** Mesmo cadastro da planilha; somente INSERT, sem substituir uma empresa ou senha existente. */
export async function cadastrarEmpresa(
  _: EstadoCadastroEmpresa,
  form: FormData,
): Promise<EstadoCadastroEmpresa> {
  const ctx = await escritorio(String(form.get("org_id") ?? ""));
  if ("erro" in ctx) return { erro: ctx.erro };
  const validacao = validarCadastroIndividual(form);
  if (validacao.erro) return { erro: validacao.erro };
  const e = validacao.dados!;
  const tabela = e.origem === "sefaz" ? "xml_empresas" : "xml_nfse_empresas";
  const campo = e.origem === "sefaz" ? "ie" : "cnpj";
  const existente = await ctx.supabase
    .from(tabela)
    .select("id")
    .eq("org_id", ctx.org)
    .eq(campo, e[campo])
    .maybeSingle();
  if (existente.error)
    return { erro: "Não foi possível conferir os cadastros. Tente novamente." };
  if (existente.data)
    return {
      erro: "Esta empresa já está cadastrada nesta origem e escritório. Use o cadastro existente.",
    };
  const db = clienteAdmin();
  let acessoId: string | null = null,
    acessoCriado = false;
  if (e.origem === "sefaz") {
    acessoId = String(form.get("acesso_id") ?? "");
    if (acessoId) {
      const r = await ctx.supabase
        .from("xml_acessos")
        .select("id")
        .eq("id", acessoId)
        .eq("org_id", ctx.org)
        .maybeSingle();
      if (r.error || !r.data)
        return { erro: "Escolha um login ATF deste escritório." };
    } else {
      const login = String(form.get("login") ?? "").trim(),
        senha = String(form.get("senha") ?? "");
      if (!login || login.length > 60 || !senha || senha.length > 200)
        return {
          erro: "Informe um novo login ATF (até 60 caracteres) e sua senha (até 200 caracteres).",
        };
      const jaExiste = await ctx.supabase
        .from("xml_acessos")
        .select("id")
        .eq("org_id", ctx.org)
        .eq("login", login)
        .maybeSingle();
      if (jaExiste.error)
        return { erro: "Não foi possível conferir os logins ATF." };
      if (jaExiste.data)
        return {
          erro: "Esse login ATF já existe. Selecione-o em Login já cadastrado; sua senha será preservada.",
        };
      let cifrada: string;
      try {
        cifrada = cifrarSenha(senha);
      } catch {
        return {
          erro: "Não foi possível proteger a senha. Confira a configuração da chave pública do robô ou selecione um login já cadastrado.",
        };
      }
      const r = await db
        .from("xml_acessos")
        .insert({ org_id: ctx.org, login, senha_cifrada: cifrada })
        .select("id")
        .single();
      if (r.error || !r.data)
        return {
          erro:
            r.error?.code === "23505"
              ? "Esse login foi cadastrado durante o preenchimento. Atualize a página e selecione-o."
              : "Não foi possível salvar o login ATF.",
        };
      acessoId = r.data.id;
      acessoCriado = true;
    }
  }
  const registro = {
    org_id: ctx.org,
    cnpj: e.cnpj,
    nome: e.nome,
    nome_fixo: true,
    codigo: e.codigo,
    tipos: e.tipos,
    ...(e.origem === "sefaz"
      ? { ie: e.ie, filial: e.filial, acesso_id: acessoId }
      : {}),
  };
  const r = await db.from(tabela).insert(registro).select("id").single();
  if (acessoCriado) revalidatePath("/painel/empresas", "layout");
  if (r.error || !r.data)
    return {
      erro:
        (r.error?.code === "23505"
          ? "Esta empresa já foi cadastrada. Atualize a lista."
          : "Não foi possível salvar a empresa. Tente novamente.") +
        (acessoCriado
          ? " O novo login ATF foi salvo e pode ser selecionado na próxima tentativa."
          : ""),
    };
  revalidatePath("/painel/empresas");
  revalidatePath("/painel/agendar");
  revalidatePath("/painel/mei", "layout");
  return {
    ok: "Empresa cadastrada. Você já pode selecioná-la para agendar consultas.",
    origem: e.origem,
    id: r.data.id,
    org: ctx.org,
    cnpj: e.cnpj,
  };
}

/** Dados públicos de um CNPJ ainda não cadastrado, com o mesmo cache e limite global. */
export async function consultarCnpjCadastro(
  org: string,
  cnpj: string,
): Promise<ResultadoCnpj> {
  const ctx = await escritorio(org);
  if ("erro" in ctx) return { erro: ctx.erro };
  if (!cnpjValido(cnpj))
    return { erro: "Informe um CNPJ válido para consultar." };
  const db = clienteAdmin();
  return buscarDadosCnpj(cnpj, false, {
    reservar: async (doc, forcar) => {
      const r = await db.rpc("xml_cnpja_reservar", {
        p_cnpj: doc,
        p_forcar: forcar,
      });
      if (r.error) throw r.error;
      return r.data;
    },
    finalizar: async (doc, token, dados, bloqueio) => {
      const r = await db.rpc("xml_cnpja_finalizar", {
        p_cnpj: doc,
        p_token: token,
        p_dados: dados,
        p_bloqueio: bloqueio,
      });
      if (r.error) throw r.error;
      return r.data === true;
    },
  });
}

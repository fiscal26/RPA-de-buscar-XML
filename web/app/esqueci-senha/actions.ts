"use server";

import { criarCliente } from "@/lib/supabase/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import { emailConfigurado, enderecoSite, enviarEmail, linkCriarSenha } from "@/lib/email";
import { dentroDoLimite, registrarTentativa } from "@/lib/freio";

export type EstadoEsqueci = { ok?: string; erro?: string } | undefined;

/** Envia o link de redefinição. A resposta é a mesma exista ou não o e-mail (não revela quem tem acesso). */
export async function pedirLink(_: EstadoEsqueci, form: FormData): Promise<EstadoEsqueci> {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { erro: "Informe um e-mail válido." };
  const resposta = { ok: `Se ${email} tiver acesso ao portal, chegará em instantes um link para criar a senha nova.` };
  // freio: no máximo 2 links por e-mail a cada 15 minutos (a resposta é a mesma, para não revelar nada)
  if (!(await dentroDoLimite("senha", email))) return resposta;
  await registrarTentativa("senha", email);

  if (!emailConfigurado()) {  // sem a Brevo: o e-mail padrão do Supabase (abre só no mesmo navegador)
    const supabase = await criarCliente();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await enderecoSite()}/auth/confirmar?proximo=/redefinir-senha` });
    return { ok: `${resposta.ok} Abra o link neste mesmo navegador.` };
  }
  // só quem tem perfil ativo recebe; para os outros, a mesma resposta
  const { data: perfil } = await clienteAdmin().from("perfis").select("nome, ativo").eq("email", email).maybeSingle();
  if (!perfil?.ativo) return resposta;
  const link = await linkCriarSenha(email);
  if (!link) return resposta;
  const falha = await enviarEmail({
    para: { email, nome: perfil.nome }, assunto: "Crie sua senha nova na LotiVisse", titulo: "Senha nova",
    paragrafos: [`Olá, ${(perfil.nome || "").split(" ")[0] || "tudo bem"}.`,
      "Recebemos um pedido para trocar a senha do seu acesso. Use o botão abaixo; o link vale uma vez só e expira em breve.",
      "Se não foi você, ignore este e-mail: a senha atual continua valendo."],
    botao: { texto: "Criar senha nova", url: link },
  });
  if (falha) console.error("esqueci-senha:", falha);
  return resposta;
}

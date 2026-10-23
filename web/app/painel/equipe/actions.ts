"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { corrigirNome } from "@/lib/nomes";
import { emailConfigurado, enderecoSite, enviarEmail, linkCriarSenha } from "@/lib/email";

export type EstadoEquipe = { ok?: string; erro?: string } | undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function campos(form: FormData) {
  return {
    nome: corrigirNome(String(form.get("nome") ?? ""), 80),
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    senha: String(form.get("senha") ?? ""),
  };
}

function conferir({ nome, email, senha }: ReturnType<typeof campos>): string | null {
  if (!nome) return "Informe o nome.";
  if (!EMAIL.test(email)) return "Informe um e-mail válido.";
  if (senha && senha.length < 8) return "A senha provisória precisa de pelo menos 8 caracteres.";
  if (!senha && !emailConfigurado()) return "Defina uma senha provisória: o envio de e-mail ainda não está configurado.";
  return null;
}

/** Cria o login (já confirmado) e o perfil. Se o perfil falhar, o login é desfeito. */
async function criarAcesso(dados: ReturnType<typeof campos>, orgId: string, papel: "gestor" | "usuario"): Promise<string | null> {
  const db = clienteAdmin();
  // sem senha provisória, a pessoa cria a própria senha pelo link do e-mail de boas-vindas
  const senha = dados.senha || Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(36)).join("");
  const { data, error } = await db.auth.admin.createUser({ email: dados.email, password: senha, email_confirm: true });
  if (error || !data.user) {
    return /already|registered|exists/i.test(error?.message ?? "")
      ? `Já existe um acesso com o e-mail ${dados.email}.`
      : `Não consegui criar o acesso: ${error?.message ?? "erro desconhecido"}.`;
  }
  const { error: erroPerfil } = await db.from("perfis")
    .insert({ id: data.user.id, org_id: orgId, nome: dados.nome, email: dados.email, papel, ativo: true });
  if (erroPerfil) {
    await db.auth.admin.deleteUser(data.user.id);
    return `Não consegui salvar o perfil: ${erroPerfil.message}.`;
  }
  return null;
}

/** Boas-vindas com o link para criar a senha. Devolve o texto para quem cadastrou. */
async function boasVindas(dados: ReturnType<typeof campos>, escritorio: string): Promise<string> {
  const comSenha = dados.senha ? " Também dá para entrar com a senha provisória." : "";
  if (!emailConfigurado()) return `${dados.nome} já pode entrar com ${dados.email} e a senha provisória.`;
  const link = await linkCriarSenha(dados.email);
  const falha = link ? await enviarEmail({
    para: { email: dados.email, nome: dados.nome }, assunto: "Seu acesso à LotiVisse", titulo: "Seu acesso foi criado",
    paragrafos: [`Olá, ${dados.nome.split(" ")[0]}.`,
      `Você agora tem acesso ao portal da LotiVisse${escritorio ? ` pelo escritório ${escritorio}` : ""}. Para começar, crie a sua senha pelo botão abaixo.`,
      `Depois, entre sempre por ${await enderecoSite()}/login com o e-mail ${dados.email}. Se o link expirar, use "Esqueci minha senha" na tela de login.`],
    botao: { texto: "Criar minha senha", url: link },
  }) : "não consegui gerar o link";
  return falha
    ? `Acesso de ${dados.nome} criado, mas o e-mail não foi enviado (${falha}). Peça para usar "Esqueci minha senha".${comSenha}`
    : `Acesso de ${dados.nome} criado. Enviamos para ${dados.email} o link para criar a senha.${comSenha}`;
}

/** Admin: novo escritório e o gestor dele. */
export async function criarEscritorio(_: EstadoEquipe, form: FormData): Promise<EstadoEquipe> {
  const { admin } = await contexto();
  if (!admin) return { erro: "Só o administrador cria escritórios." };
  const escritorio = corrigirNome(String(form.get("escritorio") ?? ""), 120);
  const documento = String(form.get("documento") ?? "").replace(/\D/g, "").slice(0, 14);
  const gestor = campos(form);
  if (!escritorio) return { erro: "Informe o nome do escritório." };
  const problema = conferir(gestor);
  if (problema) return { erro: problema };
  const db = clienteAdmin();
  const { data: org, error } = await db.from("organizacoes").insert({ nome: escritorio, documento }).select("id").single();
  if (error || !org) return { erro: `Não consegui criar o escritório: ${error?.message}.` };
  const falha = await criarAcesso(gestor, org.id, "gestor");
  if (falha) {
    await db.from("organizacoes").delete().eq("id", org.id);
    return { erro: falha };
  }
  revalidatePath("/painel/equipe");
  return { ok: `Escritório ${escritorio} criado. ${await boasVindas(gestor, escritorio)}` };
}

/** Admin: pessoa em qualquer escritório (gestor ou colaborador). Gestor: colaborador do próprio escritório. */
export async function criarPessoa(_: EstadoEquipe, form: FormData): Promise<EstadoEquipe> {
  const { perfil, admin } = await contexto();
  if (!admin && perfil.papel !== "gestor") return { erro: "Só o gestor do escritório cadastra a equipe." };
  const orgId = admin ? String(form.get("org_id") ?? "") : perfil.org_id;
  const papel = admin && form.get("papel") === "gestor" ? "gestor" : "usuario";
  if (!orgId) return { erro: "Escolha o escritório." };
  const dados = campos(form);
  const problema = conferir(dados);
  if (problema) return { erro: problema };
  const falha = await criarAcesso(dados, orgId, papel);
  if (falha) return { erro: falha };
  revalidatePath("/painel/equipe");
  const { data: org } = await clienteAdmin().from("organizacoes").select("nome").eq("id", orgId).maybeSingle();
  return { ok: await boasVindas(dados, org?.nome ?? "") };
}

/** Confere se quem pede pode mexer nessa pessoa: admin em qualquer uma; gestor só nos colaboradores do escritório. */
async function alvoPermitido(id: string) {
  const { perfil, admin } = await contexto();
  if (!id || id === perfil.id) return null;  // ninguém desativa nem troca a própria senha por aqui
  const { data: alvo } = await clienteAdmin().from("perfis").select("id, org_id, papel, ativo, nome").eq("id", id).maybeSingle();
  if (!alvo) return null;
  if (admin) return alvo;
  if (perfil.papel === "gestor" && alvo.org_id === perfil.org_id && alvo.papel === "usuario") return alvo;
  return null;
}

export async function alternarAcesso(form: FormData) {
  const alvo = await alvoPermitido(String(form.get("id") ?? ""));
  if (!alvo) return;
  await clienteAdmin().from("perfis").update({ ativo: !alvo.ativo }).eq("id", alvo.id);
  revalidatePath("/painel/equipe");
}

export async function trocarSenha(_: EstadoEquipe, form: FormData): Promise<EstadoEquipe> {
  const alvo = await alvoPermitido(String(form.get("id") ?? ""));
  if (!alvo) return { erro: "Você não pode trocar a senha dessa pessoa." };
  const senha = String(form.get("senha") ?? "");
  if (senha.length < 8) return { erro: "A senha provisória precisa de pelo menos 8 caracteres." };
  const { error } = await clienteAdmin().auth.admin.updateUserById(alvo.id, { password: senha });
  if (error) return { erro: `Não consegui trocar a senha: ${error.message}.` };
  return { ok: `Senha provisória de ${alvo.nome} definida.` };
}

export async function alternarEscritorio(form: FormData) {
  const { admin } = await contexto();
  if (!admin) return;
  const id = String(form.get("id") ?? "");
  const { data: org } = await clienteAdmin().from("organizacoes").select("ativo").eq("id", id).maybeSingle();
  if (!org) return;
  await clienteAdmin().from("organizacoes").update({ ativo: !org.ativo }).eq("id", id);
  revalidatePath("/painel/equipe");
}

/** Exclui o acesso de vez (o login some e a pessoa não entra mais). Admin: qualquer pessoa; gestor: só colaboradores. */
export async function excluirPessoa(_: EstadoEquipe, form: FormData): Promise<EstadoEquipe> {
  const alvo = await alvoPermitido(String(form.get("id") ?? ""));
  if (!alvo) return { erro: "Você não pode excluir essa pessoa." };
  // apagar o login apaga o perfil junto; o que ela agendou ou lançou fica, sem o autor
  const { error } = await clienteAdmin().auth.admin.deleteUser(alvo.id);
  if (error) return { erro: `Não consegui excluir: ${error.message}.` };
  revalidatePath("/painel/equipe");
  return { ok: `${alvo.nome || "Acesso"} excluído.` };
}

/**
 * Admin: exclui o escritório inteiro — pessoas, empresas, logins do ATF, agendamentos e o Monitoramento MEI.
 * Pede o nome do escritório digitado como confirmação. Os arquivos já baixados no PC do robô não são apagados.
 */
export async function excluirEscritorio(_: EstadoEquipe, form: FormData): Promise<EstadoEquipe> {
  const { admin } = await contexto();
  if (!admin) return { erro: "Só o administrador exclui escritórios." };
  const id = String(form.get("id") ?? "");
  const db = clienteAdmin();
  const { data: org } = await db.from("organizacoes").select("id, nome").eq("id", id).maybeSingle();
  if (!org) return { erro: "Escritório não encontrado." };
  const digitado = String(form.get("confirmacao") ?? "").trim().toLocaleLowerCase("pt-BR");
  if (digitado !== org.nome.trim().toLocaleLowerCase("pt-BR")) return { erro: `Para excluir, digite o nome exato: ${org.nome}.` };

  const { data: pessoas } = await db.from("perfis").select("id").eq("org_id", id);
  for (const p of pessoas ?? []) {
    const { error } = await db.auth.admin.deleteUser(p.id);
    if (error) return { erro: `Não consegui excluir um dos acessos (${error.message}); nada mais foi apagado.` };
  }
  const { error } = await db.from("organizacoes").delete().eq("id", id);  // o resto sai em cascata
  if (error) return { erro: `Não consegui excluir o escritório: ${error.message}.` };
  revalidatePath("/painel", "layout");
  return { ok: `Escritório ${org.nome} excluído.` };
}

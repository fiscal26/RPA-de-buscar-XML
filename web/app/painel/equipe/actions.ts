"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { corrigirNome } from "@/lib/nomes";

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
  if (senha.length < 8) return "A senha provisória precisa de pelo menos 8 caracteres.";
  return null;
}

/** Cria o login (já confirmado) e o perfil. Se o perfil falhar, o login é desfeito. */
async function criarAcesso(dados: ReturnType<typeof campos>, orgId: string, papel: "gestor" | "usuario"): Promise<string | null> {
  const db = clienteAdmin();
  const { data, error } = await db.auth.admin.createUser({ email: dados.email, password: dados.senha, email_confirm: true });
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
  return { ok: `Escritório ${escritorio} criado. ${gestor.nome} já pode entrar com ${gestor.email} e a senha provisória.` };
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
  return { ok: `${dados.nome} já pode entrar com ${dados.email} e a senha provisória.` };
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

"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";
import { clienteAdmin } from "@/lib/supabase/admin";
import { corrigirNome } from "@/lib/nomes";

export type EstadoPerfil = { ok?: string; erro?: string } | undefined;

export async function salvarNome(_: EstadoPerfil, form: FormData): Promise<EstadoPerfil> {
  const { perfil } = await contexto();
  const nome = corrigirNome(String(form.get("nome") ?? ""), 80);
  if (!nome) return { erro: "Informe o nome." };
  const { error } = await clienteAdmin().from("perfis").update({ nome }).eq("id", perfil.id);
  if (error) return { erro: `Não consegui salvar: ${error.message}.` };
  revalidatePath("/painel", "layout");
  return { ok: "Nome atualizado." };
}

/** Troca a própria senha: confere a atual antes (quem pegou a sessão aberta não troca a senha). */
export async function trocarMinhaSenha(_: EstadoPerfil, form: FormData): Promise<EstadoPerfil> {
  const { supabase, perfil } = await contexto();
  const atual = String(form.get("atual") ?? "");
  const nova = String(form.get("nova") ?? "");
  const repetida = String(form.get("repetida") ?? "");
  if (nova.length < 8) return { erro: "A senha nova precisa de pelo menos 8 caracteres." };
  if (nova !== repetida) return { erro: "A confirmação não é igual à senha nova." };
  const { error: erroAtual } = await supabase.auth.signInWithPassword({ email: perfil.email, password: atual });
  if (erroAtual) return { erro: "A senha atual não confere." };
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) return { erro: `Não consegui trocar a senha: ${error.message}.` };
  return { ok: "Senha trocada. Use a nova no próximo acesso." };
}

/** Liga/desliga o e-mail de alerta do Monitoramento MEI. */
export async function salvarAlertas(_: EstadoPerfil, form: FormData): Promise<EstadoPerfil> {
  const { perfil } = await contexto();
  const ligado = form.get("alertas_mei") === "on";
  const { error } = await clienteAdmin().from("perfis").update({ alertas_mei: ligado }).eq("id", perfil.id);
  if (error) return { erro: `Não consegui salvar: ${error.message}.` };
  revalidatePath("/painel/perfil");
  return { ok: ligado ? "Você vai receber os alertas de MEI." : "Você não vai mais receber os alertas de MEI." };
}

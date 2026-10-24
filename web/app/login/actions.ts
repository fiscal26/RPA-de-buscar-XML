"use server";

import { redirect } from "next/navigation";
import { criarCliente } from "@/lib/supabase/server";
import { dentroDoLimite, limparTentativas, registrarTentativa } from "@/lib/freio";

export type EstadoLogin = { erro?: string } | undefined;

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const senha = String(form.get("senha") ?? "").slice(0, 200);
  if (!email || !senha) return { erro: "Informe e-mail e senha." };
  if (!(await dentroDoLimite("login", email))) {
    return { erro: "Muitas tentativas com senha errada. Aguarde 15 minutos ou use \"Esqueci minha senha\"." };
  }
  const supabase = await criarCliente();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) {
    await registrarTentativa("login", email);
    return { erro: "E-mail ou senha incorretos." };
  }
  await limparTentativas("login", email);
  redirect("/painel");
}

export async function sair() {
  const supabase = await criarCliente();
  await supabase.auth.signOut();
  redirect("/login");
}

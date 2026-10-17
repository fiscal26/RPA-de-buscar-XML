"use server";

import { redirect } from "next/navigation";
import { criarCliente } from "@/lib/supabase/server";

export type EstadoLogin = { erro?: string } | undefined;

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "").trim();
  const senha = String(form.get("senha") ?? "");
  if (!email || !senha) return { erro: "Informe e-mail e senha." };
  const supabase = await criarCliente();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return { erro: "E-mail ou senha incorretos." };
  redirect("/");
}

export async function sair() {
  const supabase = await criarCliente();
  await supabase.auth.signOut();
  redirect("/login");
}

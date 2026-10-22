"use server";

import { redirect } from "next/navigation";
import { criarCliente } from "@/lib/supabase/server";

export type EstadoNova = { erro?: string } | undefined;

export async function salvarSenhaNova(_: EstadoNova, form: FormData): Promise<EstadoNova> {
  const nova = String(form.get("nova") ?? "");
  if (nova.length < 8) return { erro: "A senha precisa de pelo menos 8 caracteres." };
  if (nova !== String(form.get("repetida") ?? "")) return { erro: "A confirmação não é igual à senha nova." };
  const supabase = await criarCliente();
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) return { erro: `Não consegui salvar a senha: ${error.message}.` };
  await supabase.auth.signOut();
  redirect("/login?senha=nova");
}

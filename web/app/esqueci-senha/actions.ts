"use server";

import { headers } from "next/headers";
import { criarCliente } from "@/lib/supabase/server";

export type EstadoEsqueci = { ok?: string; erro?: string } | undefined;

/** Envia o link de redefinição. A resposta é a mesma exista ou não o e-mail (não revela quem tem acesso). */
export async function pedirLink(_: EstadoEsqueci, form: FormData): Promise<EstadoEsqueci> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { erro: "Informe um e-mail válido." };
  const h = await headers();
  const site = process.env.NEXT_PUBLIC_SITE_URL
    || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const supabase = await criarCliente();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${site}/auth/confirmar?proximo=/redefinir-senha` });
  return { ok: `Se ${email} tiver acesso ao portal, chega nele em instantes um link para criar a senha nova. Abra o link neste mesmo navegador.` };
}

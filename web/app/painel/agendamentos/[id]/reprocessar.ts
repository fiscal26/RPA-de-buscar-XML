"use server";

import { revalidatePath } from "next/cache";
import { contexto } from "@/lib/sessao";

export type EstadoReprocessarErros = { erro?: string; id?: string } | undefined;

export async function reprocessarErros(_: EstadoReprocessarErros, form: FormData): Promise<EstadoReprocessarErros> {
  const { supabase } = await contexto();
  const id = String(form.get("agendamento") ?? "");
  if (!/^[\da-f-]{36}$/i.test(id)) return { erro: "Agendamento inválido." };
  const { data, error } = await supabase.rpc("xml_reprocessar_erros_sefaz", { p_id: id });
  if (error) return { erro: "Não foi possível reprocessar os erros. Confira se o agendamento terminou e tente novamente." };
  revalidatePath(`/painel/agendamentos/${id}`);
  revalidatePath("/painel/agendamentos");
  revalidatePath("/painel");
  return { id: data };
}

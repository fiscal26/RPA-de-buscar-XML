import "server-only";
import { redirect } from "next/navigation";
import { criarCliente } from "@/lib/supabase/server";

export type Perfil = {
  id: string;
  org_id: string | null;
  nome: string;
  email: string;
  papel: "admin" | "gestor" | "usuario";
  ativo: boolean;
};

export type Organizacao = { id: string; nome: string; ativo: boolean };

/** Usuário logado, perfil e organização. Manda para o login se não houver. */
export async function contexto() {
  const supabase = await criarCliente();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase.from("perfis").select("id, org_id, nome, email, papel, ativo").eq("id", user.id).maybeSingle<Perfil>();
  // usuário desativado ou sem perfil: encerra a sessão (senão ficaria indo e voltando do login)
  if (!perfil || !perfil.ativo) redirect("/sair?motivo=sem-acesso");

  let org: Organizacao | null = null;
  if (perfil.org_id) {
    const { data } = await supabase.from("organizacoes").select("id, nome, ativo").eq("id", perfil.org_id).maybeSingle<Organizacao>();
    org = data;
  }
  // escritório suspenso: ninguém dele usa o portal (o banco também esconde os dados)
  if (perfil.papel !== "admin" && (!org || !org.ativo)) redirect("/sair?motivo=suspenso");
  return { supabase, user, perfil, org, admin: perfil.papel === "admin" };
}

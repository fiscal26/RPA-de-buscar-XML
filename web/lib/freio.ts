import "server-only";
import { headers } from "next/headers";
import { clienteAdmin } from "@/lib/supabase/admin";

/**
 * Freio contra força bruta e bombardeio de e-mails: conta as tentativas recentes por e-mail e por IP
 * (tabela xml_tentativas, que só o servidor lê). Se o banco ainda não tiver a tabela, não bloqueia ninguém.
 */
type Tipo = "login" | "senha";
const REGRAS: Record<Tipo, { minutos: number; porEmail: number; porIp: number }> = {
  login: { minutos: 15, porEmail: 5, porIp: 30 },   // 5 senhas erradas por e-mail em 15 min
  senha: { minutos: 15, porEmail: 2, porIp: 10 },   // 2 links de senha nova por e-mail em 15 min
};

export async function ipDoPedido() {
  const h = await headers();
  return (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "").trim().slice(0, 64);
}

/** true = pode seguir; false = passou do limite. */
export async function dentroDoLimite(tipo: Tipo, email: string): Promise<boolean> {
  const regra = REGRAS[tipo];
  const desde = new Date(Date.now() - regra.minutos * 60_000).toISOString();
  const ip = await ipDoPedido();
  const db = clienteAdmin();
  const contar = (chave: string) => db.from("xml_tentativas").select("id", { count: "exact", head: true })
    .eq("tipo", tipo).eq("chave", chave).gte("criado_em", desde);
  const [porEmail, porIp] = await Promise.all([contar(email), ip ? contar(`ip:${ip}`) : Promise.resolve({ count: 0, error: null })]);
  if (porEmail.error || porIp.error) return true;
  return (porEmail.count ?? 0) < regra.porEmail && (porIp.count ?? 0) < regra.porIp;
}

export async function registrarTentativa(tipo: Tipo, email: string) {
  const ip = await ipDoPedido();
  const db = clienteAdmin();
  await db.from("xml_tentativas").insert([{ tipo, chave: email }, ...(ip ? [{ tipo, chave: `ip:${ip}` }] : [])]);
  // limpeza: o que tem mais de um dia não serve mais
  await db.from("xml_tentativas").delete().lt("criado_em", new Date(Date.now() - 86_400_000).toISOString());
}

export async function limparTentativas(tipo: Tipo, email: string) {
  await clienteAdmin().from("xml_tentativas").delete().eq("tipo", tipo).eq("chave", email);
}

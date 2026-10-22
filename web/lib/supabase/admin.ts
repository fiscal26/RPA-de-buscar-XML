import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Cliente com a chave secreta: ignora as regras de acesso. Use SÓ no servidor e só depois
 *  de conferir que quem pediu tem permissão (admin da plataforma ou gestor da organização). */
export function clienteAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

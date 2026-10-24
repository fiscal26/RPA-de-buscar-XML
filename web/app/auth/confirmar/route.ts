import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { criarCliente } from "@/lib/supabase/server";

// Link dos e-mails (conta nova, senha nova): abre a sessão e segue para a próxima tela.
// token_hash: links enviados pela LotiVisse (abrem em qualquer navegador); code: links antigos do Supabase.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const codigo = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const tipo = (url.searchParams.get("type") ?? "recovery") as EmailOtpType;
  const pedido = url.searchParams.get("proximo") ?? "/painel";
  // só caminhos simples do próprio site (nada de "//outro-site", "/\\outro-site" nem parâmetros)
  const proximo = /^\/(?![\/\\])[\w\-/]*$/.test(pedido) ? pedido : "/painel";
  url.search = "";
  const supabase = await criarCliente();
  let ok = false;
  if (tokenHash) ok = !(await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash })).error;
  else if (codigo) ok = !(await supabase.auth.exchangeCodeForSession(codigo)).error;
  if (ok) {
    url.pathname = proximo;
    return NextResponse.redirect(url);
  }
  url.pathname = "/login";
  url.search = "?erro=link";
  return NextResponse.redirect(url);
}

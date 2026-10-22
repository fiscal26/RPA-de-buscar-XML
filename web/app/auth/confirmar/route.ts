import { NextResponse, type NextRequest } from "next/server";
import { criarCliente } from "@/lib/supabase/server";

// Link do e-mail (redefinição de senha): troca o código pela sessão e segue para a próxima tela.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const codigo = url.searchParams.get("code");
  const proximo = url.searchParams.get("proximo") ?? "/painel";
  url.search = "";
  if (codigo) {
    const supabase = await criarCliente();
    const { error } = await supabase.auth.exchangeCodeForSession(codigo);
    if (!error) {
      url.pathname = proximo.startsWith("/") ? proximo : "/painel";
      return NextResponse.redirect(url);
    }
  }
  url.pathname = "/login";
  url.search = "?erro=link";
  return NextResponse.redirect(url);
}

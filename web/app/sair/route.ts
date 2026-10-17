import { NextResponse, type NextRequest } from "next/server";
import { criarCliente } from "@/lib/supabase/server";

// Encerra a sessão (aqui os cookies podem ser apagados) e volta ao login com o motivo, se houver.
export async function GET(request: NextRequest) {
  const supabase = await criarCliente();
  await supabase.auth.signOut();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  const motivo = request.nextUrl.searchParams.get("motivo");
  url.search = motivo ? `?erro=${encodeURIComponent(motivo)}` : "";
  return NextResponse.redirect(url);
}

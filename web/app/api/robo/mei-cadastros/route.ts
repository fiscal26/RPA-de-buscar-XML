import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import { processarVerificacaoMei } from "@/lib/mei-descoberta";
import { autorizarMeiWorker } from "@/lib/mei-worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  if (
    !autorizarMeiWorker(
      request.headers.get("x-mei-worker"),
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    )
  ) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await processarVerificacaoMei(clienteAdmin()));
  } catch {
    return NextResponse.json(
      {
        erro: "Fila cadastral indisponível. Confira o banco e tente novamente.",
      },
      { status: 503 },
    );
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";

/** Credencial específica da fila, derivada sem transmitir a chave administrativa à rota. */
export function tokenMeiWorker(segredo: string) {
  return createHmac("sha256", segredo)
    .update("lotivisse:mei-cadastros:v1")
    .digest("hex");
}
export function autorizarMeiWorker(recebido: string | null, segredo: string) {
  if (!segredo || !recebido) return false;
  const a = Buffer.from(recebido),
    b = Buffer.from(tokenMeiWorker(segredo));
  return a.length === b.length && timingSafeEqual(a, b);
}

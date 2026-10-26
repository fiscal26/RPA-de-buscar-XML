// Regras da NFS-e que o portal e a fila do banco (xml_nfse_pegar_lote) usam do mesmo jeito.

export type CertificadoResumo = { cnpj: string; validade: string | null; org_id?: string };

/** O certificado que o robô usa para o CNPJ: o próprio, senão o da matriz (0001), senão outro da mesma raiz. */
export function certificadoDoCnpj<T extends CertificadoResumo>(cnpj: string, certificados: T[]): T | undefined {
  const daRaiz = certificados.filter((c) => c.cnpj.slice(0, 8) === cnpj.slice(0, 8));
  return daRaiz.find((c) => c.cnpj === cnpj) ?? daRaiz.find((c) => c.cnpj.slice(8, 12) === "0001") ?? daRaiz[0];
}

const DIA = 86_400_000;

/** Situação da validade para mostrar ao usuário (vencido, vence em até 30 dias ou válido). */
export function situacaoValidade(validade: string | null): { nome: string; classe: string; vencido: boolean } {
  if (!validade) return { nome: "Validade não lida", classe: "st-neutro", vencido: false };
  const dias = Math.floor((Date.parse(validade) - Date.now()) / DIA);
  if (dias < 0) return { nome: "Vencido", classe: "st-erro", vencido: true };
  if (dias <= 30) return { nome: `Vence em ${dias} dia${dias === 1 ? "" : "s"}`, classe: "st-alerta", vencido: false };
  return { nome: "Válido", classe: "st-ok", vencido: false };
}

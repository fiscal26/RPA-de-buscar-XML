import { cnpjValido } from "./documentos";

export type DadosCnpj = {
  cnpj: string; razaoSocial: string; nomeFantasia: string | null; abertura: string | null;
  situacao: string | null; mei: boolean | null; inicioMei: string | null; atualizadoEm: string | null;
};
export type ResultadoCnpj = { dados?: DadosCnpj; consultadoEm?: string; reutilizado?: boolean; aviso?: string; erro?: string; aguardar?: number };
type Reserva = { status: "cache" | "consultar" | "aguardar"; token?: string; dados?: DadosCnpj; consultado_em?: string; segundos?: number };
export type ArmazenamentoCnpj = {
  reservar: (cnpj: string, forcar: boolean) => Promise<Reserva>;
  finalizar: (cnpj: string, token: string, dados: DadosCnpj | null, bloqueio: number) => Promise<boolean>;
};

const texto = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().slice(0, 240) : null;
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function dataCnpj(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** Guarda somente os campos usados no cadastro; QSA, telefones e e-mails não são armazenados. */
export function interpretarCnpj(valor: unknown, esperado: string): DadosCnpj {
  const r = objeto(valor), empresa = objeto(r.company), simei = objeto(empresa.simei);
  if (r.taxId !== esperado || !texto(empresa.name)) throw new Error("Resposta cadastral inválida.");
  const mei = typeof simei.optant === "boolean" ? simei.optant : null;
  const atualizado = typeof r.updated === "string" && Number.isFinite(Date.parse(r.updated)) ? new Date(r.updated).toISOString() : null;
  return { cnpj: esperado, razaoSocial: texto(empresa.name)!, nomeFantasia: texto(r.alias), abertura: dataCnpj(r.founded),
    situacao: texto(objeto(r.status).text), mei, inicioMei: mei === true ? dataCnpj(simei.since) : null, atualizadoEm: atualizado };
}

export function segundosDeEspera(v: string | null, agora = Date.now()): number {
  const n = v && /^\d+$/.test(v) ? Number(v) : v ? Math.ceil((Date.parse(v) - agora) / 1000) : 60;
  return Number.isFinite(n) ? Math.max(1, Math.min(3600, n)) : 60;
}

/** Somente backend. O armazenamento coordena o limite entre instâncias e escritórios. */
export async function buscarDadosCnpj(cnpj: string, forcar: boolean, db: ArmazenamentoCnpj, requisitar: typeof fetch = fetch): Promise<ResultadoCnpj> {
  if (!cnpjValido(cnpj)) return { erro: "CNPJ inválido." };
  let reserva: Reserva;
  try { reserva = await db.reservar(cnpj, forcar); }
  catch { return { erro: "A consulta de CNPJ está indisponível. Você pode preencher o cadastro manualmente." }; }
  if (reserva.status === "cache" && reserva.dados) return { dados: reserva.dados, consultadoEm: reserva.consultado_em, reutilizado: true };
  if (reserva.status === "aguardar") return { aguardar: reserva.segundos ?? 13, erro: `Há consultas em andamento. Aguarde ${reserva.segundos ?? 13} segundos e tente novamente.` };
  if (reserva.status !== "consultar" || !reserva.token) return { erro: "Não foi possível iniciar a consulta." };
  let bloqueio = 0;
  let erro = "Não foi possível consultar a CNPJá. O preenchimento manual continua disponível.";
  try {
    const r = await requisitar(`https://open.cnpja.com/office/${cnpj}`, { headers: { Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    if (r.status === 429) {
      bloqueio = segundosDeEspera(r.headers.get("Retry-After"));
      erro = `A CNPJá atingiu o limite gratuito. Aguarde ${bloqueio} segundos e tente novamente.`;
    } else if (r.status === 404) erro = "CNPJ não encontrado na base pública. Confira o número ou preencha manualmente.";
    else if (r.ok) {
      const dados = interpretarCnpj(await r.json(), cnpj);
      if (!(await db.finalizar(cnpj, reserva.token, dados, 0))) return { erro: "Esta consulta expirou. Consulte novamente para obter os dados confirmados." };
      return { dados, consultadoEm: new Date().toISOString(), reutilizado: false };
    }
  } catch { /* timeout, resposta inválida ou falha de rede: mantém a última consulta válida */ }
  try { await db.finalizar(cnpj, reserva.token, null, bloqueio); } catch { /* reserva expira sozinha */ }
  return reserva.dados ? { dados: reserva.dados, consultadoEm: reserva.consultado_em, reutilizado: true,
    aviso: `${erro} Exibindo a última consulta salva; os dados podem estar desatualizados.` } : { erro, aguardar: bloqueio || undefined };
}

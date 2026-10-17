// CNPJ e datas — mesmas regras do robô (robo/planilha.py).

export const soDigitos = (s: string) => s.replace(/\D/g, "");

function dv(numeros: string, pesos: number[]) {
  const soma = [...numeros].reduce((t, n, i) => t + Number(n) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjValido(cnpj: string) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const d1 = dv(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.slice(-2) === `${d1}${d2}`;
}

/** CNPJ só com números, recolocando zeros à esquerda que o Excel apaga. */
export function normalizarCnpj(valor: unknown): { cnpj?: string; erro?: string } {
  if (valor === null || valor === undefined || String(valor).trim() === "") return { erro: "CNPJ vazio" };
  const digitos = soDigitos(String(valor));
  if (!digitos) return { erro: `'${valor}' não é CNPJ` };
  if (digitos.length > 14) return { erro: `'${valor}' tem mais de 14 dígitos` };
  const cnpj = digitos.padStart(14, "0");
  if (!cnpjValido(cnpj)) return { erro: `CNPJ ${digitos} inválido (dígito verificador não confere — confira a digitação)` };
  return { cnpj };
}

export function formatarCnpj(c: string) {
  return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
}

/** aaaa-mm-dd -> dd/mm/aaaa */
export function dataBR(iso: string | null | undefined) {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function dataHoraBR(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

/** Primeiro e último dia do mês anterior (aaaa-mm-dd), o período mais pedido. */
export function mesAnterior(hoje = new Date()) {
  const fim = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), 0));
  const inicio = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), 1));
  return { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
}

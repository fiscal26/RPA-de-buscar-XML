// CNPJ, inscrição estadual da Paraíba e datas — mesmas regras do robô (robo/planilha.py).

export const soDigitos = (s: string) => s.replace(/\D/g, "");

function dv(numeros: string, pesos: number[]) {
  const soma = [...numeros].reduce((t, n, i) => t + Number(n) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjValido(cnpj: string) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  return cnpj.slice(-2) === `${dv(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}${dv(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

export function cpfValido(cpf: string) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  return cpf.slice(-2) === `${dv(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2])}${dv(cpf.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

/** Inscrição estadual da Paraíba: 9 dígitos, módulo 11 com pesos 9 a 2 (resto 0 ou 1 -> dígito 0). */
export function iePbValida(ie: string) {
  if (!/^\d{9}$/.test(ie) || /^(\d)\1{8}$/.test(ie)) return false;
  const resto = [...ie.slice(0, 8)].reduce((t, n, i) => t + Number(n) * (9 - i), 0) % 11;
  return Number(ie[8]) === (resto < 2 ? 0 : 11 - resto);
}

const numero = (valor: unknown) => soDigitos(String(valor ?? ""));

/** IE só com números, recolocando os zeros à esquerda que o Excel apaga. */
export function normalizarIe(valor: unknown): { ie?: string; erro?: string } {
  const d = numero(valor);
  if (!d) return { erro: "inscrição estadual vazia" };
  if (d.length > 9) return { erro: `inscrição estadual '${valor}' tem mais de 9 dígitos` };
  const ie = d.padStart(9, "0");
  if (!iePbValida(ie)) return { erro: `inscrição estadual ${d} inválida para a Paraíba (dígito verificador não confere)` };
  return { ie };
}

/** CNPJ (ou CPF de produtor rural) opcional: vazio é aceito; preenchido precisa ser válido. */
export function normalizarDocumento(valor: unknown): { doc: string; erro?: string } {
  const d = numero(valor);
  if (!d) return { doc: "" };
  if (d.length > 8 && d.length <= 11 && cpfValido(d.padStart(11, "0"))) return { doc: d.padStart(11, "0") };
  if (d.length <= 14 && cnpjValido(d.padStart(14, "0"))) return { doc: d.padStart(14, "0") };
  return { doc: "", erro: `CNPJ ${d} inválido (dígito verificador não confere — confira a digitação)` };
}

export function formatarDocumento(d: string) {
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}

export function formatarIe(ie: string) {
  return ie.length === 9 ? `${ie.slice(0, 2)}.${ie.slice(2, 5)}.${ie.slice(5, 8)}-${ie.slice(8)}` : ie;
}

/** aaaa-mm-dd -> dd/mm/aaaa */
export function dataBR(iso: string | null | undefined) {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** aaaa-mm-dd -> mm/aaaa */
export function competenciaBR(iso: string | null | undefined) {
  if (!iso) return "";
  const [a, m] = iso.slice(0, 7).split("-");
  return `${m}/${a}`;
}

export function dataHoraBR(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

/** Competência do mês anterior (aaaa-mm), a mais pedida. */
export function mesAnterior(hoje = new Date()) {
  const ref = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - 1, 1));
  return ref.toISOString().slice(0, 7);
}

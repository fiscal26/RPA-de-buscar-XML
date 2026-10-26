import "server-only";
import { cnpjValido, formatarDocumento, soDigitos } from "@/lib/documentos";
import { chave, linhasDoArquivo, marcado, texto, type Linha } from "@/lib/planilha";
import { TIPOS_NFSE } from "@/lib/xml";
import { corrigirNome } from "@/lib/nomes";

/** Empresa da planilha da NFS-e (Portal Nacional): uma por CNPJ. Sem senha: o acesso é o certificado A1. */
export type LinhaNfse = { cnpj: string; nome: string; codigo: string; tipos: string[]; linha: number };
export type LeituraNfse = { empresas: LinhaNfse[]; erros: string[]; avisos: string[] };

const NOMES = ["nome fantasia", "nome", "razao social", "empresa"];

/** Colunas: ATIVA, ID, CNPJ, NOME FANTASIA e os serviços NFS-e Emitidas, NFS-e Recebidas, PDF (DANFSe),
 *  Relatório de Retenções. Sem as colunas de serviço, faz tudo. */
export async function lerPlanilhaNfse(arquivo: File): Promise<LeituraNfse> {
  return interpretarNfse(await linhasDoArquivo(arquivo));
}

export function interpretarNfse(linhas: Linha[]): LeituraNfse {
  const leitura: LeituraNfse = { empresas: [], erros: [], avisos: [] };
  const inicio = linhas.findIndex((l) => l.valores.some((v) => chave(v) === "cnpj"));
  if (inicio < 0) {
    leitura.erros.push("Cabeçalho não encontrado: use a planilha modelo da NFS-e (coluna CNPJ).");
    return leitura;
  }
  if (linhas[inicio].valores.some((v) => chave(v) === "inscricao estadual")) {
    leitura.erros.push("Esta é a planilha da SEFAZ. Para a NFS-e, use a planilha modelo da NFS-e.");
    return leitura;
  }
  const colunas = new Map<string, number>();
  linhas[inicio].valores.forEach((v, i) => { const k = chave(v); if (k && !colunas.has(k)) colunas.set(k, i); });
  const campo = (valores: unknown[], nome: string) => { const i = colunas.get(nome); return i === undefined ? null : valores[i]; };
  const colunaNome = NOMES.find((n) => colunas.has(n));
  const temServicos = TIPOS_NFSE.some((t) => colunas.has(t.coluna));

  const vistas = new Set<string>();
  for (const { n, valores } of linhas.slice(inicio + 1)) {
    const bruto = texto(campo(valores, "cnpj"));
    const nome = corrigirNome(colunaNome ? texto(campo(valores, colunaNome)) : "");
    if (!bruto && !nome && !texto(campo(valores, "id"))) continue;
    const rotulo = nome || `linha ${n}`;
    if (marcado(campo(valores, "ativa")) === false) {
      leitura.avisos.push(`Linha ${n}: ${rotulo} está como inativa e foi ignorada`);
      continue;
    }
    const cnpj = soDigitos(bruto).padStart(14, "0");
    if (!bruto) { leitura.erros.push(`Linha ${n}: ${rotulo}: informe o CNPJ`); continue; }
    if (!cnpjValido(cnpj)) { leitura.erros.push(`Linha ${n}: ${rotulo}: CNPJ ${bruto} inválido (dígito verificador não confere)`); continue; }
    const tipos = temServicos ? TIPOS_NFSE.filter((t) => marcado(campo(valores, t.coluna))).map((t) => t.id as string)
      : TIPOS_NFSE.map((t) => t.id as string);
    if (!tipos.some((t) => t === "nfse_emitidas" || t === "nfse_recebidas")) {
      leitura.avisos.push(`Linha ${n}: ${rotulo}: marque NFS-e Emitidas ou NFS-e Recebidas; a linha foi ignorada`);
      continue;
    }
    if (vistas.has(cnpj)) { leitura.avisos.push(`Linha ${n}: CNPJ ${formatarDocumento(cnpj)} repetido; foi considerado só uma vez`); continue; }
    vistas.add(cnpj);
    leitura.empresas.push({ cnpj, nome: (nome || formatarDocumento(cnpj)).slice(0, 60), codigo: texto(campo(valores, "id")).slice(0, 20), tipos, linha: n });
  }
  return leitura;
}

import "server-only";
import readXlsxFile from "read-excel-file/node";
import { formatarIe, normalizarDocumento, normalizarIe } from "@/lib/documentos";
import { TIPOS } from "@/lib/xml";

/** Linha lida da planilha. A senha em texto só existe dentro do servidor, durante a leitura. */
export type LinhaEmpresa = {
  ie: string; nome: string; cnpj: string; codigo: string; filial: string;
  login: string; senha: string; tipos: string[]; linha: number;
};
export type Leitura = { empresas: LinhaEmpresa[]; erros: string[]; avisos: string[] };

type Linha = { n: number; valores: unknown[] };

/** Lê a planilha modelo (.xlsx, primeira aba) ou um .csv com os mesmos cabeçalhos.
 *  As colunas são achadas pelo nome (ATIVA, ID, ID_FILIAL, CNPJ, INSCRICAO ESTADUAL, NOME FANTASIA,
 *  LOGIN, SENHA, NF-e Saida, NF-e Entrada, NFC-e); as outras colunas são de outros serviços. */
export async function lerPlanilha(arquivo: File): Promise<Leitura> {
  const nome = arquivo.name.toLowerCase();
  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const linhas = nome.endsWith(".xlsx") || nome.endsWith(".xlsm") ? await linhasExcel(bytes) : linhasTexto(bytes);
  return interpretar(linhas);
}

async function linhasExcel(bytes: Buffer): Promise<Linha[]> {
  const abas = await readXlsxFile(bytes);
  return (abas[0]?.data ?? []).map((valores, i) => ({ n: i + 1, valores: valores as unknown[] }));
}

function linhasTexto(bytes: Buffer): Linha[] {
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    texto = new TextDecoder("windows-1252").decode(bytes); // Bloco de Notas / Excel no Windows
  }
  texto = texto.replace(/^﻿/, "");
  const linhas: Linha[] = [];
  texto.split(/\r?\n/).forEach((bruta, i) => {
    if (!bruta.trim() || bruta.trimStart().startsWith("#")) return;
    const sep = [";", "\t", ","].find((s) => bruta.includes(s));
    const campos = sep ? bruta.split(sep) : [bruta];
    linhas.push({ n: i + 1, valores: campos.map((c) => c.trim().replace(/^"|"$/g, "")) });
  });
  return linhas;
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Cabeçalho comparável: sem acento, sem pontuação, minúsculo ("NF-e Saída" -> "nfe saida"). */
export function chave(v: unknown) {
  return texto(v).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/-/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

const SIM = new Set(["s", "sim", "x", "1", "true", "verdadeiro", "v", "ok", "ativa", "ativo", "✓", "✔"]);
const NAO = new Set(["n", "nao", "0", "false", "falso", "f", "inativa", "inativo"]);

/** true = sim, false = não, null = em branco */
export function marcado(v: unknown): boolean | null {
  const t = chave(v) || texto(v);
  if (!t) return null;
  if (SIM.has(t) || t.startsWith("sim")) return true;
  if (NAO.has(t) || t.startsWith("nao")) return false;
  return null;
}

function interpretar(linhas: Linha[]): Leitura {
  const leitura: Leitura = { empresas: [], erros: [], avisos: [] };
  const inicio = linhas.findIndex((l) => l.valores.some((v) => chave(v) === "inscricao estadual"));
  if (inicio < 0) {
    leitura.erros.push("Cabeçalho não encontrado: use a planilha modelo (coluna INSCRICAO ESTADUAL).");
    return leitura;
  }
  const colunas = new Map<string, number>();
  linhas[inicio].valores.forEach((v, i) => { const k = chave(v); if (k && !colunas.has(k)) colunas.set(k, i); });
  const faltando = ["nome fantasia", "login", "senha"].filter((c) => !colunas.has(c));
  if (faltando.length) {
    leitura.erros.push(`Faltam colunas na planilha: ${faltando.map((c) => c.toUpperCase()).join(", ")}`);
    return leitura;
  }
  const campo = (valores: unknown[], nome: string) => { const i = colunas.get(nome); return i === undefined ? null : valores[i]; };

  const vistas = new Set<string>();
  for (const { n, valores } of linhas.slice(inicio + 1)) {
    if (!valores.some((v) => texto(v))) continue;
    const nome = texto(campo(valores, "nome fantasia"));
    const rotulo = nome || `linha ${n}`;
    if (marcado(campo(valores, "ativa")) === false) {
      leitura.avisos.push(`Linha ${n}: ${rotulo} está como inativa; ignorada`);
      continue;
    }
    const { ie, erro } = normalizarIe(campo(valores, "inscricao estadual"));
    if (!ie) { leitura.erros.push(`Linha ${n}: ${rotulo}: ${erro}`); continue; }
    if (!nome) { leitura.erros.push(`Linha ${n}: informe o NOME FANTASIA da IE ${formatarIe(ie)}`); continue; }
    const doc = normalizarDocumento(campo(valores, "cnpj"));
    if (doc.erro) { leitura.erros.push(`Linha ${n}: ${nome}: ${doc.erro}`); continue; }
    const login = texto(campo(valores, "login"));
    if (!login) { leitura.erros.push(`Linha ${n}: ${nome}: informe o LOGIN do ATF`); continue; }
    const tipos = TIPOS.filter((t) => marcado(campo(valores, t.coluna))).map((t) => t.id as string);
    if (!tipos.length) {
      leitura.avisos.push(`Linha ${n}: ${nome}: nenhum XML marcado (NF-e Saida, NF-e Entrada, NFC-e); ignorada`);
      continue;
    }
    if (vistas.has(ie)) { leitura.avisos.push(`Linha ${n}: IE ${formatarIe(ie)} repetida; usada só uma vez`); continue; }
    vistas.add(ie);
    leitura.empresas.push({
      ie, nome: nome.slice(0, 60), cnpj: doc.doc, codigo: texto(campo(valores, "id")).slice(0, 20),
      filial: texto(campo(valores, "id filial")).slice(0, 20), login: login.slice(0, 60),
      senha: texto(campo(valores, "senha")).slice(0, 200), tipos, linha: n,
    });
  }
  return leitura;
}

import "server-only";
import readXlsxFile from "read-excel-file/node";
import { normalizarCnpj, formatarCnpj } from "@/lib/cnpj";

/** Linha lida da planilha. A senha em texto só existe dentro do servidor, durante a leitura. */
export type LinhaEmpresa = { cnpj: string; apelido: string; senha: string; login: string; linha: number };
export type Leitura = { empresas: LinhaEmpresa[]; erros: string[]; avisos: string[] };

type Linha = { n: number; valores: unknown[] };

/** Lê a planilha (.xlsx, aba "Empresas" ou a primeira) ou o texto (.csv/.txt).
 *  Colunas: CNPJ | Apelido | Senha ATF | Login ATF (opcional) — as mesmas do modelo. */
export async function lerPlanilha(arquivo: File): Promise<Leitura> {
  const nome = arquivo.name.toLowerCase();
  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const linhas = nome.endsWith(".xlsx") || nome.endsWith(".xlsm") ? await linhasExcel(bytes) : linhasTexto(bytes);
  return interpretar(linhas);
}

async function linhasExcel(bytes: Buffer): Promise<Linha[]> {
  const abas = await readXlsxFile(bytes);
  const aba = abas.find((a) => a.sheet === "Empresas") ?? abas[0];
  return (aba?.data ?? []).map((valores, i) => ({ n: i + 1, valores: valores.slice(0, 4) as unknown[] }));
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
    const linha = bruta.trim();
    if (!linha || linha.startsWith("#")) return;
    const sep = [";", "\t", ","].find((s) => linha.includes(s));
    const campos = sep ? linha.split(sep) : [linha];
    linhas.push({ n: i + 1, valores: campos.map((c) => c.trim().replace(/^"|"$/g, "")) });
  });
  return linhas;
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function interpretar(linhas: Linha[]): Leitura {
  const leitura: Leitura = { empresas: [], erros: [], avisos: [] };
  const vistos = new Set<string>();
  for (const { n, valores } of linhas) {
    const [cnpjBruto, apelido, senha, login] = [0, 1, 2, 3].map((i) => texto(valores[i]));
    if (!cnpjBruto && !apelido && !senha && !login) continue;
    if (/cnpj/i.test(cnpjBruto) && !/\d{5}/.test(cnpjBruto)) continue; // cabeçalho

    const { cnpj, erro } = normalizarCnpj(valores[0]);
    if (!cnpj) {
      leitura.erros.push(`Linha ${n}: ${erro}`);
      continue;
    }
    if (!apelido) {
      leitura.erros.push(`Linha ${n}: informe o apelido da empresa ${formatarCnpj(cnpj)}`);
      continue;
    }
    if (vistos.has(cnpj)) {
      leitura.avisos.push(`Linha ${n}: ${formatarCnpj(cnpj)} repetido; usado só uma vez`);
      continue;
    }
    vistos.add(cnpj);
    leitura.empresas.push({ cnpj, apelido: apelido.slice(0, 60), senha: senha.slice(0, 200), login: login.slice(0, 60), linha: n });
  }
  return leitura;
}

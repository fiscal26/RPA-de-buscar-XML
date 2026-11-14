export type LinhaEmpresa = {
  org_id: string;
  id: string; origem: "sefaz" | "nfse"; nome: string; fixo: boolean; cnpj: string; codigo: string;
  escritorio: string; ie?: string; servicos: string; acesso: string; acessoDetalhe: string;
  acessoClasse: string; pendencia: boolean; mei: "ativo" | "pausado" | "ausente" | "indisponivel";
};


export type EmpresaAgrupada = LinhaEmpresa & { chave: string; cadastros: LinhaEmpresa[] };

export function agruparEmpresas(linhas: LinhaEmpresa[]): EmpresaAgrupada[] {
  const grupos = new Map<string, EmpresaAgrupada>();
  for (const linha of linhas) {
    const documento = linha.cnpj.replace(/\D/g, "");
    // Cadastros sem documento continuam independentes.
    const chave = JSON.stringify([linha.org_id, documento || `${linha.origem}:${linha.id}`]);
    const grupo = grupos.get(chave);
    if (grupo) {
      grupo.cadastros.push(linha);
      grupo.pendencia ||= linha.pendencia;
      if (linha.mei === "ativo") grupo.mei = "ativo";
    } else {
      grupos.set(chave, { ...linha, cnpj: documento, chave, cadastros: [linha] });
    }
  }
  return [...grupos.values()];
}

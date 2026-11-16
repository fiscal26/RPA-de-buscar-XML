import {
  cnpjValido,
  normalizarDocumento,
  normalizarIe,
  soDigitos,
} from "./documentos";
import { corrigirNome } from "./nomes";
import { IDS_TIPOS, IDS_TIPOS_NFSE, type Origem } from "./xml";

export type CadastroIndividual = {
  origem: Origem;
  cnpj: string;
  ie: string;
  nome: string;
  codigo: string;
  filial: string;
  tipos: string[];
};
export function validarCadastroIndividual(
  form: FormData,
):
  | { dados: CadastroIndividual; erro?: never }
  | { erro: string; dados?: never } {
  const origem = String(form.get("origem") ?? "");
  if (origem !== "sefaz" && origem !== "nfse")
    return { erro: "Escolha SEFAZ ou NFS-e." };
  const nomeBruto = String(form.get("nome") ?? "").trim();
  if (!nomeBruto || nomeBruto.length > 60)
    return { erro: "Informe o nome da empresa com até 60 caracteres." };
  const nome = corrigirNome(nomeBruto);
  if (!nome) return { erro: "Informe o nome da empresa." };
  const bruto = String(form.get("cnpj") ?? "");
  const documento = normalizarDocumento(bruto);
  if (origem === "nfse" && !cnpjValido(soDigitos(bruto)))
    return { erro: "Informe um CNPJ válido para a NFS-e." };
  if (documento.erro) return { erro: documento.erro };
  const inscricao =
    origem === "sefaz" ? normalizarIe(form.get("ie")) : { ie: "" };
  if (inscricao.erro) return { erro: inscricao.erro };
  const permitidos = origem === "sefaz" ? IDS_TIPOS : IDS_TIPOS_NFSE;
  const tipos = [...new Set(form.getAll("tipos").map(String))];
  if (!tipos.length || tipos.some((t) => !permitidos.includes(t)))
    return { erro: "Selecione serviços válidos para a origem escolhida." };
  if (
    origem === "nfse" &&
    !tipos.some((t) => t === "nfse_emitidas" || t === "nfse_recebidas")
  )
    return { erro: "Selecione NFS-e Emitidas ou NFS-e Recebidas." };
  const codigo = String(form.get("codigo") ?? "").trim(),
    filial = String(form.get("filial") ?? "").trim();
  if (codigo.length > 20 || filial.length > 20)
    return { erro: "Código e filial devem ter até 20 caracteres." };
  return {
    dados: {
      origem,
      nome,
      cnpj: documento.doc,
      ie: inscricao.ie!,
      codigo,
      filial,
      tipos,
    },
  };
}

import { ASSUNTOS } from "@/lib/assuntos";
import { DESCRICAO, SITE_URL } from "@/lib/site";

// Resumo do site para assistentes de IA (formato llms.txt: https://llmstxt.org).
// Sai do mesmo conteúdo das páginas por assunto: quando um assunto muda, o resumo muda junto.

const RESUMO = `# LotiVisse

> ${DESCRICAO}

A LotiVisse (${SITE_URL}) é um robô para escritórios de contabilidade e departamentos fiscais no Brasil. O escritório
envia uma planilha com as empresas, agenda a competência no portal e recebe as notas fiscais em pastas por empresa e
competência (ano e mês).

- Notas de produto e transporte pela SEFAZ, com o login do contador: XML de NF-e (saída e entrada), NFC-e e CT-e
  (remetente e destinatário), além de faturas, extrato de pagamentos, omissão e inadimplência, certidão de débitos e
  conferência do cartão de crédito. Disponível hoje na SEFAZ da Paraíba (ATF).
- Notas de serviço pelo Portal Nacional da NFS-e, com o certificado A1 da empresa: NFS-e emitidas e recebidas em XML e
  PDF, em lote e sem captcha, em todo o Brasil (municípios do padrão nacional), com relatório de retenções (ISS, IRRF,
  PIS, COFINS, CSLL e INSS) por nota e em totais.
- Monitoramento de Faturamento MEI: faturamento e compras de cada MEI no ano contra o limite de R$ 81.000, com aviso por
  e-mail à equipe do escritório quando o MEI chega perto ou passa do limite.

Senhas e certificados são cifrados antes de serem guardados; só o robô consegue abri-los.`;

export function llmsTxt(): string {
  const paginas = ASSUNTOS.map((a) => `- [${a.titulo}](${SITE_URL}/${a.slug}): ${a.descricao}`).join("\n");
  return `${RESUMO}

## Páginas

- [Página inicial](${SITE_URL}/): o que o robô faz, onde funciona e perguntas frequentes.
${paginas}

## Opcional

- [Texto completo das páginas](${SITE_URL}/llms-full.txt)
- [Planilha modelo da SEFAZ](${SITE_URL}/modelos/modelo_empresas_sefaz_pb.xlsx)
- [Planilha modelo da NFS-e](${SITE_URL}/modelos/modelo_empresas_nfse.xlsx)
`;
}

export function llmsFullTxt(): string {
  const paginas = ASSUNTOS.map((a) => {
    const blocos = a.blocos.map((b) => `### ${b.titulo}\n\n${b.texto ?? ""}${(b.lista ?? []).map((i) => `- ${i}`).join("\n")}`).join("\n\n");
    const perguntas = a.perguntas.map(([p, r]) => `**${p}**\n${r}`).join("\n\n");
    return `## ${a.h1}\n\nEndereço: ${SITE_URL}/${a.slug}\n\n${a.abertura}\n\n${blocos}\n\n### Perguntas frequentes\n\n${perguntas}`;
  }).join("\n\n---\n\n");
  return `${RESUMO}\n\n---\n\n${paginas}\n`;
}

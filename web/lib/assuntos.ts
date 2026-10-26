// Páginas por assunto (uma busca do Google = uma página). Cada item vira /<slug>, entra no sitemap,
// ganha título, descrição e perguntas frequentes para o Google. Para criar uma página nova, acrescente um item.

export type Bloco = { titulo: string; texto?: string; lista?: string[] };
export type Assunto = {
  slug: string;
  titulo: string;        // aba do navegador e resultado do Google (até ~60 caracteres)
  descricao: string;     // texto do resultado do Google (até ~155 caracteres)
  menu: string;          // nome curto nos links do site
  h1: string;
  abertura: string;
  blocos: Bloco[];
  perguntas: [string, string][];
  planilha: { href: string; texto: string };
};

const PLANILHA_SEFAZ = { href: "/modelos/modelo_empresas_sefaz_pb.xlsx", texto: "Baixar a planilha modelo da SEFAZ" };
const PLANILHA_NFSE = { href: "/modelos/modelo_empresas_nfse.xlsx", texto: "Baixar a planilha modelo da NFS-e" };

export const ASSUNTOS: Assunto[] = [
  {
    slug: "baixar-xml-nfe-sefaz",
    titulo: "Robô para baixar XML de NF-e, NFC-e e CT-e na SEFAZ",
    descricao: "Baixe os XMLs de NF-e de saída e entrada, NFC-e e CT-e de todas as empresas do escritório, organizados por empresa e competência, sem clicar empresa por empresa.",
    menu: "XML de NF-e, NFC-e e CT-e",
    h1: "Baixar o XML das notas fiscais de todas as empresas, de uma vez",
    abertura: "O robô entra no portal da SEFAZ com o login do contador, pede as notas de cada empresa da planilha e guarda os XMLs na pasta certa. O escritório deixa de baixar nota por nota e de conferir se faltou alguma.",
    blocos: [
      { titulo: "O que o robô baixa", lista: [
        "NF-e de saída e de entrada, com o valor das notas autorizadas no nome da pasta.",
        "NFC-e emitidas pela empresa.",
        "CT-e como remetente e como destinatário.",
        "Junto, se marcado: faturas (DAR/PIX), extrato de pagamentos, omissão e inadimplência, certidão de débitos e conferência do cartão de crédito.",
      ] },
      { titulo: "Como fica a pasta", texto: "Uma pasta por empresa e, dentro dela, uma por competência (ano e mês). O arquivo vem como a SEFAZ entregou, sem ser alterado, e as notas canceladas ficam fora do valor somado. É só levar a pasta para o sistema contábil ou fiscal." },
      { titulo: "Onde funciona hoje", texto: "Na SEFAZ da Paraíba, pelo ATF. Novos estados entram conforme a demanda dos escritórios. As notas de serviço (NFS-e) já funcionam no Brasil todo pelo Portal Nacional." },
    ],
    perguntas: [
      ["Preciso informar a senha de cada empresa?", "Não. O robô usa o login do contador no portal da SEFAZ, o mesmo que o escritório já usa para consultar as empresas. A senha vai cifrada e só o robô consegue abri-la."],
      ["O XML vem completo?", "Sim. O robô guarda o arquivo exatamente como a SEFAZ entregou; ele só lê o conteúdo para saber de qual empresa é e para somar o valor das notas autorizadas."],
      ["Posso agendar para o começo do mês?", "Sim. Escolha a competência e a data e a hora em que o robô deve começar; ele busca do primeiro ao último dia do mês."],
    ],
    planilha: PLANILHA_SEFAZ,
  },
  {
    slug: "baixar-nfse-em-lote",
    titulo: "Baixar NFS-e em lote pelo Portal Nacional (XML e PDF)",
    descricao: "Baixe as NFS-e emitidas e recebidas de todas as empresas em XML e PDF pela API oficial do Portal Nacional, com o certificado A1, sem captcha.",
    menu: "NFS-e em lote (Portal Nacional)",
    h1: "Baixar as NFS-e emitidas e recebidas de todas as empresas, sem captcha",
    abertura: "No Emissor Nacional, baixar nota por nota exige resolver um captcha a cada arquivo. O robô usa a API oficial do Portal Nacional da NFS-e com o certificado A1 da empresa e traz a competência inteira de uma vez, em XML e PDF.",
    blocos: [
      { titulo: "O que vem", lista: [
        "NFS-e emitidas pela empresa e NFS-e recebidas (em que ela é a tomadora).",
        "O XML de cada nota e o PDF (DANFSe).",
        "Só as notas válidas: as canceladas e as substituídas ficam fora.",
        "O relatório de retenções da competência, por nota e em totais.",
      ] },
      { titulo: "Do que precisa", texto: "Do certificado digital A1 (e-CNPJ) da empresa, enviado uma vez no portal. O certificado da matriz também serve às filiais. O arquivo e a senha ficam cifrados e só o robô abre." },
      { titulo: "Onde funciona", texto: "Em todo o Brasil, nas notas dos municípios que usam o padrão nacional da NFS-e. Prefeituras com portal próprio entram conforme a demanda dos escritórios." },
    ],
    perguntas: [
      ["Por que pelo certificado e não por login e senha?", "Porque a API oficial do Portal Nacional, que entrega as notas em lote e sem captcha, é acessada com o certificado digital da empresa. Pelo login e senha do Emissor Nacional, o download exige um captcha a cada nota."],
      ["A API do Portal Nacional é paga?", "Não. A distribuição das NFS-e pela API oficial não tem custo; o que a empresa precisa é do certificado A1 válido."],
      ["Uma filial precisa de certificado próprio?", "Não. O robô usa o certificado da matriz para consultar as notas da filial (mesma raiz do CNPJ)."],
      ["As notas antigas vêm também?", "Sim. Na primeira busca o robô traz o histórico disponível no Portal Nacional; nas seguintes, só o que for novo."],
    ],
    planilha: PLANILHA_NFSE,
  },
  {
    slug: "relatorio-retencoes-nfse",
    titulo: "Relatório de retenções da NFS-e: ISS, IRRF, PIS, COFINS, CSLL e INSS",
    descricao: "Relatório em Excel com as retenções de cada NFS-e: ISS retido, IRRF, PIS, COFINS, CSLL e INSS, por nota e em totais, para emitidas e recebidas.",
    menu: "Relatório de retenções da NFS-e",
    h1: "As retenções de cada nota de serviço, prontas numa planilha",
    abertura: "Para cada competência, o robô lê as NFS-e emitidas e recebidas da empresa e monta uma planilha com o que foi retido em cada nota e os totais do mês. Acabou a digitação nota por nota para conferir o ISS e as retenções federais.",
    blocos: [
      { titulo: "O que a planilha mostra", lista: [
        "Uma linha por nota: número, data, competência, CNPJ e nome do cliente ou do prestador, valor do serviço.",
        "ISS (alíquota, valor e se foi retido pelo tomador ou pelo intermediário).",
        "IRRF, PIS, COFINS, CSLL e INSS (contribuição previdenciária) retidos.",
        "Total retido e valor líquido de cada nota, com os totais no fim e uma aba de resumo.",
        "Aviso na nota quando o total retido informado não bate com a soma das retenções.",
      ] },
      { titulo: "Emitidas e recebidas, separadas", texto: "Nas notas emitidas, as retenções foram feitas pelos clientes da empresa: entram como valores a compensar na apuração do ISS, do IRPJ, das contribuições e da contribuição previdenciária. Nas notas recebidas, quem reteve foi a empresa: ela responde pelo recolhimento (o ISS ao município; IRRF, PIS/COFINS/CSLL e INSS informados na EFD-Reinf e pagos pela guia da DCTFWeb)." },
      { titulo: "De onde vêm os números", texto: "Do XML oficial de cada NFS-e, baixado do Portal Nacional. O relatório usa os valores que estão na nota; ele não recalcula alíquotas." },
    ],
    perguntas: [
      ["O relatório substitui a conferência do contador?", "Não. Ele junta o que está nas notas para a conferência ficar rápida; a análise de cada retenção continua sendo do escritório."],
      ["Serve para a EFD-Reinf?", "Ajuda: as notas recebidas com retenção estão listadas com o prestador, o valor e cada tributo retido, que são as informações que o escritório confere antes de enviar a EFD-Reinf."],
      ["Em que formato vem?", "Em Excel (.xlsx), com abas de resumo, emitidas e recebidas, filtros e a linha de totais com fórmulas."],
    ],
    planilha: PLANILHA_NFSE,
  },
  {
    slug: "limite-faturamento-mei",
    titulo: "Limite do MEI: monitoramento do faturamento e das compras",
    descricao: "Acompanhe o faturamento e as compras de cada MEI contra o limite de R$ 81 mil no ano, com aviso por e-mail quando chegar perto ou passar do limite.",
    menu: "Limite de faturamento do MEI",
    h1: "Saber antes que o MEI passe do limite de faturamento",
    abertura: "O robô busca no dossiê do contribuinte na SEFAZ as notas de saída e de entrada e as vendas no cartão de cada MEI, mês a mês. O portal soma o ano, compara com os limites e avisa a equipe do escritório quando um MEI se aproxima ou passa do limite.",
    blocos: [
      { titulo: "O que é acompanhado", lista: [
        "Faturamento: o maior valor entre as notas de saída e as vendas no cartão, mais as receitas lançadas à mão.",
        "Compras: as notas de entrada mais as compras lançadas à mão.",
        "Limite de R$ 81.000 de faturamento no ano, proporcional no ano de abertura (R$ 6.750 por mês de atividade).",
        "Compras comparadas com 80% do limite (R$ 64.800 no ano cheio).",
      ] },
      { titulo: "Os avisos", texto: "A equipe do escritório recebe um e-mail quando o MEI está no ritmo de passar do limite, quando chega a 80%, quando passa de 100% e quando passa de 120%. Cada aviso sai uma vez por ano, para não virar ruído." },
      { titulo: "Por que importa", texto: "Passar do limite em até 20% leva ao desenquadramento a partir do ano seguinte, com o pagamento sobre o excesso. Passar de 20% faz o desenquadramento retroagir ao início do ano. Ver o ritmo com antecedência dá tempo de orientar o cliente." },
    ],
    perguntas: [
      ["Funciona para qualquer MEI?", "Para os MEIs optantes pelo SIMEI com inscrição estadual na SEFAZ da Paraíba, onde o robô consulta o dossiê do contribuinte."],
      ["E as vendas sem nota?", "Podem ser lançadas à mão no portal, como receita do mês, e entram na soma do faturamento."],
      ["Quem recebe os avisos?", "As pessoas da equipe do escritório no portal. Cada pessoa pode desligar os avisos no próprio perfil."],
    ],
    planilha: PLANILHA_SEFAZ,
  },
];

export const SLUGS_ASSUNTOS = ASSUNTOS.map((a) => a.slug);
export const assuntoPorSlug = (slug: string) => ASSUNTOS.find((a) => a.slug === slug);

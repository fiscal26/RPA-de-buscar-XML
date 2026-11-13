"use client";

import { useActionState, useState, useTransition } from "react";
import Escolha from "@/components/ui/Escolha";
import { dataBR, dataHoraBR, formatarDocumento } from "@/lib/documentos";
import type { CadastroMei } from "@/lib/mei-carteira";
import type { ResultadoCnpj } from "@/lib/cnpja";
import { consultarCnpj } from "./consulta-cnpj";
import { salvarCadastroMei } from "./actions";

type Empresa = { org: string; cnpj: string; nome: string; escritorio: string; sugestao: boolean };
export default function FormCadastroMei({ empresas, cadastros }: { empresas: Empresa[]; cadastros: CadastroMei[] }) {
  const [selecionada, selecionar] = useState("");
  const empresa = empresas.find((e) => `${e.org}|${e.cnpj}` === selecionada);
  const cadastro = cadastros.find((c) => c.org_id === empresa?.org && c.cnpj === empresa?.cnpj);
  return (
    <div className="formulario">
      <label htmlFor="empresa-mei">Empresa</label>
      <Escolha id="empresa-mei" rotulo="Empresa para acompanhar como MEI" valor={selecionada} aoMudar={selecionar}
        opcoes={empresas.map((e) => ({ id: `${e.org}|${e.cnpj}`, titulo: e.nome, etiqueta: e.sugestao ? "Possível MEI" : undefined,
          sub: `${formatarDocumento(e.cnpj)}${e.escritorio ? ` · ${e.escritorio}` : ""}` }))} />
      {empresa && <CamposMei key={selecionada} empresa={empresa} cadastro={cadastro} />}
    </div>
  );
}

function CamposMei({ empresa, cadastro }: { empresa: Empresa; cadastro?: CadastroMei }) {
  const [estado, acao, pendente] = useActionState(salvarCadastroMei, undefined);
  const [abertura, setAbertura] = useState(cadastro?.inicio_atividade ?? "");
  const [inicio, setInicio] = useState(cadastro?.inicio_mei.slice(0, 7) ?? "");
  const [fim, setFim] = useState(cadastro?.fim_mei?.slice(0, 7) ?? "");
  const [ativo, setAtivo] = useState(cadastro?.ativo ?? true);
  const [consulta, setConsulta] = useState<ResultadoCnpj>();
  const [consultando, iniciarConsulta] = useTransition();
  const [aplicado, setAplicado] = useState(false);
  const dados = consulta?.dados;
  const divergente = dados && ((cadastro?.inicio_atividade && dados.abertura && cadastro.inicio_atividade !== dados.abertura)
    || (cadastro?.inicio_mei && dados.inicioMei && cadastro.inicio_mei.slice(0, 7) !== dados.inicioMei.slice(0, 7))
    || (cadastro?.ativo && dados.mei === false));
  const buscar = (forcar: boolean) => iniciarConsulta(async () => {
    setAplicado(false);
    try { setConsulta(await consultarCnpj(empresa.org, empresa.cnpj, forcar)); }
    catch { setConsulta({ erro: "Não foi possível concluir a consulta. Seus campos foram preservados; tente novamente ou preencha manualmente." }); }
  });
  return (
    <form action={acao}>
      {empresa.sugestao && !cadastro && <p className="faixa alerta">Uma NFS-e importada informa enquadramento MEI.
        Confira o período antes de cadastrar: uma nota antiga não comprova o enquadramento atual.</p>}
      <div className="linha" style={{ marginTop: "1rem" }}>
        <button type="button" className="secundario" disabled={consultando || pendente} onClick={() => buscar(false)}>
          {consultando ? "Consultando…" : "Consultar dados do CNPJ"}
        </button>
        {dados && <button type="button" className="secundario" disabled={consultando || pendente} onClick={() => buscar(true)}>Atualizar consulta na CNPJá</button>}
      </div>
      <p className="suave">Consulta gratuita à CNPJá. Os dados podem estar defasados; confira antes de salvar.
        A abertura do CNPJ e a entrada no MEI são datas diferentes.</p>
      {consulta?.erro && <p className="faixa alerta" role="status">{consulta.erro}</p>}
      {dados && <div className="faixa" style={{ borderColor: "var(--linha)" }} role="status">
        <p><b>{dados.razaoSocial}</b>{dados.nomeFantasia && ` · ${dados.nomeFantasia}`}</p>
        <p>Abertura: <b>{dados.abertura ? dataBR(dados.abertura) : "não informada"}</b> · Situação: <b>{dados.situacao ?? "não informada"}</b></p>
        <p>MEI na base consultada: <b>{dados.mei === null ? "não informado" : dados.mei ? "Sim" : "Não"}</b>
          {dados.inicioMei && ` · inclusão em ${dataBR(dados.inicioMei)}`}</p>
        <p className="suave">Fonte: CNPJá · consulta {consulta.consultadoEm ? dataHoraBR(consulta.consultadoEm) : "sem data"}
          {dados.atualizadoEm && ` · atualização informada pela fonte: ${dataHoraBR(dados.atualizadoEm)}`}
          {consulta.reutilizado && " · consulta salva reaproveitada"}</p>
        {consulta.aviso && <p className="texto-erro">{consulta.aviso}</p>}
        {divergente && <p className="texto-erro">Há divergência em relação ao cadastro confirmado. Os campos existentes não foram alterados.</p>}
        {dados.mei !== true && <p className="suave">A consulta não confirma enquadramento MEI atual. Confira a situação antes de acompanhar a empresa.</p>}
        <button type="button" className="secundario" disabled={pendente || consultando || !((!abertura && dados.abertura) || (!inicio && dados.inicioMei))}
          onClick={() => {
            if (!abertura && dados.abertura) setAbertura(dados.abertura);
            if (!inicio && dados.inicioMei) setInicio(dados.inicioMei.slice(0, 7));
            setAplicado(true);
          }}>Preencher campos vazios</button>
        {aplicado && <p className="suave">Sugestões preenchidas. Confira as datas e clique em Salvar cadastro MEI para confirmar.</p>}
      </div>}
      <input type="hidden" name="org" value={empresa.org} /><input type="hidden" name="cnpj" value={empresa.cnpj} />
      <label className="caixa-opcao"><input type="checkbox" name="ativo" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Acompanhar esta empresa como MEI</label>
      <div className="grade-campos">
        <label>Data de abertura<input type="date" name="abertura" value={abertura} onChange={(e) => setAbertura(e.target.value)} required /></label>
        <label>MEI desde<input type="month" name="inicio" value={inicio} onChange={(e) => setInicio(e.target.value)} required /></label>
        <label>Último mês como MEI (opcional)<input type="month" name="fim" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
      </div>
      <p className="suave">O cadastro vale para este CNPJ no escritório, tanto na SEFAZ quanto na NFS-e.
        Desmarcar pausa o acompanhamento e preserva o histórico. Para encerrar o enquadramento e manter os anos anteriores visíveis, informe o último mês.</p>
      <button disabled={pendente || consultando}>{pendente ? "Salvando…" : "Salvar cadastro MEI"}</button>
      {estado && <p className={`faixa ${estado.erro ? "erro" : "ok"}`} role="status">{estado.erro || estado.ok}</p>}
    </form>
  );
}

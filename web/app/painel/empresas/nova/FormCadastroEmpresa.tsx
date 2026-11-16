"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Formulario from "@/components/ui/Formulario";
import Escolha from "@/components/ui/Escolha";
import Segmentado from "@/components/ui/Segmentado";
import { cnpjValido, dataBR, dataHoraBR, soDigitos } from "@/lib/documentos";
import type { ResultadoCnpj } from "@/lib/cnpja";
import { TIPOS, TIPOS_NFSE, type Origem } from "@/lib/xml";
import { cadastrarEmpresa, consultarCnpjCadastro } from "../cadastro-actions";

type Props = {
  organizacoes: { id: string; nome: string }[];
  acessos: { id: string; org_id: string; login: string }[];
  orgInicial?: string;
  origemInicial: Origem;
};
export default function FormCadastroEmpresa(p: Props) {
  const [org, setOrg] = useState(
    p.organizacoes.some((o) => o.id === p.orgInicial)
      ? p.orgInicial!
      : p.organizacoes.length === 1
        ? p.organizacoes[0].id
        : "",
  );
  const [origem, setOrigem] = useState<Origem>(p.origemInicial);
  return (
    <>
      <label htmlFor="empresa-org">Escritório</label>
      <Escolha
        id="empresa-org"
        rotulo="Escritório"
        valor={org}
        aoMudar={setOrg}
        opcoes={p.organizacoes.map((o) => ({ id: o.id, titulo: o.nome }))}
      />
      <p className="rotulo-campo">Origem das consultas</p>
      <Segmentado
        nome="origem-escolha"
        rotulo="Origem das consultas"
        valor={origem}
        aoMudar={setOrigem}
        opcoes={[
          { id: "nfse", texto: "NFS-e · Portal Nacional" },
          { id: "sefaz", texto: "SEFAZ · Paraíba" },
        ]}
      />
      <p className="suave">
        O mesmo CNPJ pode ter os dois cadastros. Para adicionar a outra origem,
        cadastre-a separadamente; a lista reúne os dois.
      </p>
      {org ? (
        <Campos
          key={`${org}:${origem}`}
          org={org}
          origem={origem}
          acessos={p.acessos.filter((a) => a.org_id === org)}
        />
      ) : (
        <p className="suave">Escolha o escritório para preencher a empresa.</p>
      )}
    </>
  );
}
function Campos({
  org,
  origem,
  acessos,
}: {
  org: string;
  origem: Origem;
  acessos: Props["acessos"];
}) {
  const [estado, acao, pendente] = useActionState(cadastrarEmpresa, undefined);
  const [campos, setCampos] = useState({
    codigo: "",
    filial: "",
    ie: "",
    login: "",
    senha: "",
  });
  const [tipos, setTipos] = useState<string[]>(
    (origem === "nfse" ? TIPOS_NFSE : TIPOS)
      .filter(
        (t) =>
          origem === "nfse" ||
          ["nfe_saida", "nfe_entrada", "nfce", "faturas"].includes(t.id),
      )
      .map((t) => t.id),
  );
  const erro = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (estado?.erro) erro.current?.focus();
    if (estado?.ok) setCampos((c) => ({ ...c, senha: "" }));
  }, [estado]);
  const campo = (chave: keyof typeof campos) => ({
    value: campos[chave],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setCampos((c) => ({ ...c, [chave]: e.target.value })),
  });
  const pendenteDoc = useRef<string | null>(null);
  const [nome, setNome] = useState("");
  const nomeEditado = useRef(false);
  const [cnpj, setCnpj] = useState("");
  const docAtual = useRef("");
  const requisicao = useRef(0);
  const [consulta, setConsulta] = useState<ResultadoCnpj>();
  const [consultando, buscar] = useTransition();
  const [acesso, setAcesso] = useState(acessos.length ? "" : "novo");
  const [erroConsulta, setErroConsulta] = useState("");
  function consultar() {
    const doc = soDigitos(cnpj);
    if (!cnpjValido(doc)) {
      setErroConsulta(
        "Informe um CNPJ válido para consultar. O preenchimento manual continua disponível.",
      );
      return;
    }
    if (pendenteDoc.current === doc) return;
    pendenteDoc.current = doc;
    const numero = ++requisicao.current;
    setErroConsulta("");
    buscar(async () => {
      try {
        const r = await consultarCnpjCadastro(org, doc);
        if (numero !== requisicao.current || doc !== docAtual.current) return;
        setConsulta(r);
        if (r.dados && !r.aviso && !nomeEditado.current)
          setNome((r.dados.nomeFantasia || r.dados.razaoSocial).slice(0, 60));
      } catch {
        if (numero === requisicao.current)
          setErroConsulta(
            "Consulta indisponível. Você pode preencher o nome manualmente.",
          );
      } finally {
        if (numero === requisicao.current) pendenteDoc.current = null;
      }
    });
  }
  if (estado?.ok)
    return (
      <div className="cadastro-sucesso" role="status">
        <h2>Empresa cadastrada</h2>
        <p>{estado.ok}</p>
        <div className="linha">
          <Link
            className="botao"
            href={`/painel/agendar?origem=${origem}&fonte=cadastro&org=${org}&empresa=${origem === "nfse" ? estado.cnpj : estado.id}`}
          >
            Agendar consultas desta empresa
          </Link>
          <Link className="botao secundario" href="/painel/empresas">
            Ver empresas
          </Link>
          <button className="secundario" onClick={() => location.reload()}>
            Cadastrar outra empresa
          </button>
        </div>
        <p className="suave">
          Se for MEI, a verificação automática seguirá as decisões de
          acompanhamento já registradas pelo escritório.
        </p>
      </div>
    );
  return (
    <Formulario
      action={acao}
      className="formulario"
      // Respostas com erro também disparam reset de Server Actions; preserve as escolhas da tentativa.
      onReset={(e) => e.preventDefault()}
    >
      <input type="hidden" name="org_id" value={org} />
      <input type="hidden" name="origem" value={origem} />
      <label htmlFor="empresa-cnpj">
        {origem === "nfse" ? "CNPJ" : "CNPJ ou CPF (opcional)"}
      </label>
      <div className="linha">
        <input
          type="text"
          id="empresa-cnpj"
          name="cnpj"
          value={cnpj}
          maxLength={18}
          inputMode="numeric"
          autoComplete="off"
          required={origem === "nfse"}
          onChange={(e) => {
            setCnpj(e.target.value);
            docAtual.current = soDigitos(e.target.value);
            setConsulta(undefined);
            setErroConsulta("");
          }}
          onBlur={() => {
            if (cnpjValido(soDigitos(cnpj))) consultar();
          }}
        />
        <button
          type="button"
          className="secundario"
          disabled={consultando || pendente}
          onClick={consultar}
        >
          {consultando ? "Consultando…" : "Consultar CNPJ"}
        </button>
      </div>
      <p className="suave">
        A consulta sugere o nome e informa abertura e SIMEI. Confira antes de
        salvar; você pode preencher manualmente.
      </p>
      {(erroConsulta || consulta?.erro) && (
        <p className="faixa alerta" role="status">
          {erroConsulta || consulta?.erro}
        </p>
      )}
      {consulta?.dados && (
        <div className="faixa" role="status">
          <b>{consulta.dados.razaoSocial}</b>
          <p>
            Abertura:{" "}
            {consulta.dados.abertura
              ? dataBR(consulta.dados.abertura)
              : "não informada"}{" "}
            · MEI na base:{" "}
            {consulta.dados.mei === true
              ? "Sim"
              : consulta.dados.mei === false
                ? "Não"
                : "não informado"}
            {consulta.dados.inicioMei &&
              ` · início no SIMEI: ${dataBR(consulta.dados.inicioMei)}`}
          </p>
          <p className="suave">
            Fonte: CNPJá · consulta{" "}
            {consulta.consultadoEm
              ? dataHoraBR(consulta.consultadoEm)
              : "sem data"}
            . Os dados podem estar defasados.
          </p>
          {consulta.aviso && <p className="texto-erro">{consulta.aviso}</p>}
        </div>
      )}
      <label htmlFor="empresa-nome">Nome da empresa</label>
      <input
        type="text"
        id="empresa-nome"
        name="nome"
        value={nome}
        onChange={(e) => {
          nomeEditado.current = true;
          setNome(e.target.value);
        }}
        maxLength={60}
        required
        autoComplete="organization"
      />
      <p className="suave">
        O nome confirmado aqui será mantido nas próximas importações de
        planilhas.
      </p>
      <label htmlFor="empresa-codigo">Código no escritório (opcional)</label>
      <input
        type="text"
        id="empresa-codigo"
        name="codigo"
        {...campo("codigo")}
        maxLength={20}
        autoComplete="off"
      />
      {origem === "sefaz" ? (
        <>
          <div className="grade-campos">
            <label>
              Inscrição estadual da Paraíba
              <input
                type="text"
                name="ie"
                {...campo("ie")}
                inputMode="numeric"
                maxLength={12}
                required
              />
            </label>
            <label>
              Código da filial (opcional)
              <input
                type="text"
                name="filial"
                {...campo("filial")}
                maxLength={20}
              />
            </label>
          </div>
          <label htmlFor="empresa-acesso">Login já cadastrado</label>
          <Escolha
            id="empresa-acesso"
            rotulo="Login já cadastrado"
            valor={acesso}
            aoMudar={(v) => {
              setAcesso(v);
              setCampos((c) => ({ ...c, login: "", senha: "" }));
            }}
            opcoes={[
              { id: "novo", titulo: "Cadastrar novo login ATF" },
              ...acessos.map((a) => ({ id: a.id, titulo: a.login })),
            ]}
          />
          <input
            type="hidden"
            name="acesso_id"
            value={acesso === "novo" ? "" : acesso}
          />
          {acesso === "novo" && (
            <div className="grade-campos">
              <label>
                Novo login ATF
                <input
                  type="text"
                  name="login"
                  {...campo("login")}
                  maxLength={60}
                  required
                  autoComplete="off"
                />
              </label>
              <label>
                Senha ATF
                <input
                  name="senha"
                  {...campo("senha")}
                  type="password"
                  maxLength={200}
                  required
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}
          <p className="suave">
            Um login pode atender várias empresas. Um acesso já cadastrado é
            reutilizado com a senha que já está guardada. A senha nova será
            cifrada para o robô.
          </p>
        </>
      ) : (
        <p className="faixa">
          O cadastro pode ser salvo antes de enviar o certificado. Para
          consultar NFS-e, envie um A1 da empresa, da matriz ou do escritório
          com procuração em{" "}
          <Link href="/painel/certificados">Certificados</Link>.
        </p>
      )}
      <fieldset>
        <legend>Serviços para consultar</legend>
        <div className="cadastro-servicos">
          {(origem === "sefaz" ? TIPOS : TIPOS_NFSE).map((t) => (
            <label className="caixa-opcao" key={t.id}>
              <input
                name="tipos"
                type="checkbox"
                value={t.id}
                checked={tipos.includes(t.id)}
                onChange={(e) =>
                  setTipos((x) =>
                    e.target.checked
                      ? [...x, t.id]
                      : x.filter((v) => v !== t.id),
                  )
                }
              />
              {t.nome}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="suave">
        Salvar cadastra a empresa. As consultas começam somente quando você
        fizer um agendamento.
      </p>
      <button disabled={pendente || consultando}>
        {pendente ? "Salvando…" : "Salvar empresa"}
      </button>
      {estado?.erro && (
        <p ref={erro} tabIndex={-1} className="faixa erro" role="alert">
          {estado.erro}
        </p>
      )}
    </Formulario>
  );
}

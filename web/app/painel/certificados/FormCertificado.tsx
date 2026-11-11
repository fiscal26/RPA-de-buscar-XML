"use client";

import Escolha from "@/components/ui/Escolha";
import SeletorArquivo from "@/components/ui/SeletorArquivo";
import { useActionState, useEffect, useRef } from "react";
import { salvarCertificado } from "../actions-nfse";

type Org = { id: string; nome: string };

/** Envio do certificado A1. A senha vai só para o servidor conferir e cifrar; o formulário limpa ao salvar. */
export default function FormCertificado({ organizacoes }: { organizacoes?: Org[] }) {
  const [estado, acao, enviando] = useActionState(salvarCertificado, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (estado?.ok) form.current?.reset(); }, [estado]);
  return (
    <form ref={form} action={acao} className="formulario">
      {estado && <div className={`faixa ${estado.erro ? "erro" : "ok"}`}>{estado.erro ?? estado.ok}</div>}
      <div className="grade-campos">
        {organizacoes && (
          <div>
            <label htmlFor="c-org">Escritório</label>
            <Escolha id="c-org" nome="org_id" rotulo="Escritório" placeholder="Escolha o escritório…"
              opcoes={organizacoes.map((o) => ({ id: o.id, titulo: o.nome }))} />
          </div>
        )}
        <div>
          <label htmlFor="c-arquivo">Certificado A1</label>
          <SeletorArquivo id="c-arquivo" nome="arquivo" aceita=".pfx,.p12,application/x-pkcs12" obrigatorio titulo="Escolher o certificado (.pfx ou .p12)" />
        </div>
        <div>
          <label htmlFor="c-senha">Senha do certificado</label>
          <input id="c-senha" name="senha" type="password" required autoComplete="off" />
        </div>
        <div>
          <label htmlFor="c-cnpj">CNPJ (só se o portal não achar no certificado)</label>
          <input id="c-cnpj" name="cnpj" type="text" inputMode="numeric" autoComplete="off" />
        </div>
      </div>
      <label className="caixa-opcao">
        <input type="checkbox" name="procurador" />
        <span>
          <b>Certificado do escritório (procuração).</b> O e-CNPJ do escritório ou o e-CPF do contador. Serve para todas as
          empresas que deram procuração eletrônica ao escritório no e-CAC, sem precisar do certificado de cada uma.
        </span>
      </label>
      <button type="submit" disabled={enviando}>{enviando ? "Conferindo…" : "Salvar certificado"}</button>
    </form>
  );
}

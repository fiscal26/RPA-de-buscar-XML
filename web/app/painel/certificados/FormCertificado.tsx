"use client";

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
            <select id="c-org" name="org_id" required defaultValue="">
              <option value="" disabled>Escolha…</option>
              {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="c-arquivo">Certificado A1 (.pfx ou .p12)</label>
          <input id="c-arquivo" name="arquivo" type="file" accept=".pfx,.p12,application/x-pkcs12" required />
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
      <button type="submit" disabled={enviando}>{enviando ? "Conferindo…" : "Salvar certificado"}</button>
    </form>
  );
}

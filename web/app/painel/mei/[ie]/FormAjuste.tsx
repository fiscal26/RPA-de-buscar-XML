"use client";

import { useActionState, useEffect, useRef } from "react";
import { adicionarAjuste } from "../actions";
import { MESES_LONGOS } from "@/lib/mei";

/** Lançamento manual: receita que o ATF não mostra (venda sem nota, por exemplo) ou compra; negativo corrige. */
export default function FormAjuste({ org, ie, ano, mesPadrao }: { org: string; ie: string; ano: number; mesPadrao: number }) {
  const [estado, acao, enviando] = useActionState(adicionarAjuste, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado?.ok) form.current?.reset();
  }, [estado]);
  return (
    <form ref={form} action={acao} className="form-ajuste">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="ie" value={ie} />
      {estado && <div className={`faixa ${estado.erro ? "erro" : "ok"}`}>{estado.erro ?? estado.ok}</div>}
      <div className="form-ajuste-campos">
        <label>Mês
          <select name="competencia" defaultValue={`${ano}-${String(mesPadrao + 1).padStart(2, "0")}`}>
            {MESES_LONGOS.map((m, i) => <option key={m} value={`${ano}-${String(i + 1).padStart(2, "0")}`}>{m}</option>)}
          </select>
        </label>
        <label>Tipo
          <select name="tipo" defaultValue="receita">
            <option value="receita">Receita (faturamento)</option>
            <option value="compra">Compra</option>
          </select>
        </label>
        <label className="largo">Descrição
          <input name="descricao" type="text" maxLength={120} placeholder="Ex.: vendas sem nota para pessoa física" required />
        </label>
        <label>Valor (R$)
          <input name="valor" type="text" inputMode="decimal" placeholder="0,00" required />
        </label>
        <button type="submit" disabled={enviando}>{enviando ? "Salvando…" : "Incluir"}</button>
      </div>
    </form>
  );
}

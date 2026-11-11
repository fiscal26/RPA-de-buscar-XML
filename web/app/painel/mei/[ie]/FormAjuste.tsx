"use client";

import Escolha from "@/components/ui/Escolha";
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
        <div className="rotulo">Mês
          <Escolha nome="competencia" rotulo="Mês" padrao={`${ano}-${String(mesPadrao + 1).padStart(2, "0")}`} busca={false} avatar={false}
            opcoes={MESES_LONGOS.map((m, i) => ({ id: `${ano}-${String(i + 1).padStart(2, "0")}`, titulo: m[0].toUpperCase() + m.slice(1) }))} />
        </div>
        <div className="rotulo">Tipo
          <Escolha nome="tipo" rotulo="Tipo" padrao="receita" avatar={false}
            opcoes={[{ id: "receita", titulo: "Receita (faturamento)" }, { id: "compra", titulo: "Compra" }]} />
        </div>
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

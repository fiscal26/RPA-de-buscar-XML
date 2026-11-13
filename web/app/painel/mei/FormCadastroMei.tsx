"use client";

import { useActionState, useState } from "react";
import Escolha from "@/components/ui/Escolha";
import { formatarDocumento } from "@/lib/documentos";
import type { CadastroMei } from "@/lib/mei-carteira";
import { salvarCadastroMei } from "./actions";

type Empresa = { org: string; cnpj: string; nome: string; escritorio: string; sugestao: boolean };
export default function FormCadastroMei({ empresas, cadastros }: { empresas: Empresa[]; cadastros: CadastroMei[] }) {
  const [selecionada, selecionar] = useState("");
  const [estado, acao, pendente] = useActionState(salvarCadastroMei, undefined);
  const empresa = empresas.find((e) => `${e.org}|${e.cnpj}` === selecionada);
  const cadastro = cadastros.find((c) => c.org_id === empresa?.org && c.cnpj === empresa?.cnpj);
  return (
    <form action={acao} className="formulario">
      <label htmlFor="empresa-mei">Empresa</label>
        <Escolha id="empresa-mei" rotulo="Empresa para acompanhar como MEI" valor={selecionada} aoMudar={selecionar}
          opcoes={empresas.map((e) => ({ id: `${e.org}|${e.cnpj}`, titulo: e.nome, etiqueta: e.sugestao ? "Possível MEI" : undefined,
            sub: `${formatarDocumento(e.cnpj)}${e.escritorio ? ` · ${e.escritorio}` : ""}` }))} />
      {empresa && <div key={selecionada}>
        {empresa.sugestao && !cadastro && <p className="faixa alerta">Uma NFS-e importada informa enquadramento MEI.
          Confira o período antes de cadastrar: uma nota antiga não comprova o enquadramento atual.</p>}
        <input type="hidden" name="org" value={empresa.org} /><input type="hidden" name="cnpj" value={empresa.cnpj} />
        <label className="caixa-opcao"><input type="checkbox" name="ativo" defaultChecked={cadastro?.ativo ?? true} />
          Acompanhar esta empresa como MEI</label>
        <div className="grade-campos">
          <label>Data de abertura<input type="date" name="abertura" defaultValue={cadastro?.inicio_atividade} required /></label>
          <label>MEI desde<input type="month" name="inicio" defaultValue={cadastro?.inicio_mei.slice(0, 7)} required /></label>
          <label>Último mês como MEI (opcional)<input type="month" name="fim" defaultValue={cadastro?.fim_mei?.slice(0, 7)} /></label>
        </div>
        <p className="suave">O cadastro vale para este CNPJ no escritório, tanto na SEFAZ quanto na NFS-e.
          Desmarcar pausa o acompanhamento e preserva o histórico. Para encerrar o enquadramento e manter os anos anteriores visíveis, informe o último mês.</p>
        <button disabled={pendente}>{pendente ? "Salvando…" : "Salvar cadastro MEI"}</button>
      </div>}
      {estado && <p className={`faixa ${estado.erro ? "erro" : "ok"}`} role="status">{estado.erro || estado.ok}</p>}
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { reprocessarMei } from "./actions";

export default function FormReprocessar({ org, documento, competencia }: { org: string; documento: string; competencia: string }) {
  const [estado, acao, pendente] = useActionState(reprocessarMei, undefined);
  return (
    <form action={acao}>
      <input type="hidden" name="org" value={org} /><input type="hidden" name="documento" value={documento} />
      <div className="linha">
        <label>Competência<input type="month" name="competencia" defaultValue={competencia} required /></label>
        <button disabled={pendente}>{pendente ? "Enviando…" : "Reprocessar competência"}</button>
      </div>
      <p className="suave">Consulta novamente as fontes cadastradas para a empresa. Substitui os valores importados do mês,
        sem duplicar notas nem apagar lançamentos manuais. O robô precisa estar atualizado e ligado.</p>
      {estado && <div className={`faixa ${estado.erro ? "erro" : "ok"}`} role="status">
        <p>{estado.erro || estado.ok}</p>
        {estado.agendamentos?.map((id, i) => <p key={id}><Link href={`/painel/agendamentos/${id}`}>Acompanhar consulta {i + 1}</Link></p>)}
      </div>}
    </form>
  );
}

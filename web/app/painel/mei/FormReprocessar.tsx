"use client";

import PeriodoCompetencias from "@/components/ui/PeriodoCompetencias";
import { competenciaBR } from "@/lib/documentos";
import Link from "next/link";
import { useActionState } from "react";
import { reprocessarMei } from "./actions";

export default function FormReprocessar({ org, documento, competencia }: { org: string; documento: string; competencia: string }) {
  const [estado, acao, pendente] = useActionState(reprocessarMei, undefined);
  return (
    <form action={acao}>
      <input type="hidden" name="org" value={org} /><input type="hidden" name="documento" value={documento} />
      <div className="linha">
        <PeriodoCompetencias competencia={competencia} minimo="2018-01" />
        <button disabled={pendente}>{pendente ? "Enviando…" : "Reprocessar período"}</button>
      </div>
      <p className="suave">Consulta novamente as fontes cadastradas para a empresa. Substitui os valores importados de cada mês,
        sem duplicar notas nem apagar lançamentos manuais. O robô precisa estar atualizado e ligado.</p>
      {estado && <div className={`faixa ${estado.erro ? "erro" : "ok"}`} role="status">
        <p>{estado.erro || estado.ok}</p>
        {estado.consultas?.map((c) => <p key={c.id}><Link href={`/painel/agendamentos/${c.id}`}>Acompanhar {competenciaBR(c.competencia)} · {c.origem === "nfse" ? "NFS-e" : "SEFAZ"}</Link></p>)}
      </div>}
    </form>
  );
}

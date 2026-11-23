"use client";

import Formulario from "@/components/ui/Formulario";

import PeriodoCompetencias from "@/components/ui/PeriodoCompetencias";
import { competenciaBR } from "@/lib/documentos";
import Link from "next/link";
import { useActionState } from "react";
import { reprocessarMei } from "./actions";

const nomeFonte = (origem: string) => origem === "nfse" ? "NFS-e" : "SEFAZ";
const nomeFontes = (origens: string[]) => ["nfse", "sefaz"].filter((origem) => origens.includes(origem)).map(nomeFonte).join(" e ");

export default function FormReprocessar({ org, documento, competencia, fontes }: {
  org: string; documento: string; competencia: string; fontes: string[] | null;
}) {
  const [estado, acao, pendente] = useActionState(reprocessarMei, undefined);
  const fontesNaFila = nomeFontes(estado?.consultas?.map((c) => c.origem) ?? []);
  return (
    <Formulario action={acao}>
      <input type="hidden" name="org" value={org} /><input type="hidden" name="documento" value={documento} />
      <p className="suave">Fontes do reprocessamento <strong>{fontes ? nomeFontes(fontes) || "Nenhuma cadastrada" : "A verificar no envio"}</strong></p>
      <div className="linha">
        <PeriodoCompetencias competencia={competencia} minimo="2018-01" />
        <button className="botao-reprocessar" disabled={pendente}>{pendente ? "Enviando…" : "Reprocessar período"}</button>
      </div>
      <p className="suave">Substitui os valores importados de cada mês,
        sem duplicar notas nem apagar lançamentos manuais. O robô precisa estar atualizado e ligado.</p>
      {estado && <div className={`faixa ${estado.erro ? "erro" : "ok"}`} role="status">
        <p>{estado.erro || estado.ok}</p>
        {fontesNaFila && <p>Fontes na fila <strong>{fontesNaFila}</strong></p>}
        {estado.consultas?.map((c) => <p key={c.id}><Link className="link-discreto" href={`/painel/agendamentos/${c.id}`}>Acompanhar {competenciaBR(c.competencia)} · {nomeFonte(c.origem)}</Link></p>)}
      </div>}
    </Formulario>
  );
}

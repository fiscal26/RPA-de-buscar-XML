"use client";

import { useActionState, useState } from "react";
import { horaBR } from "@/lib/monitor";
import { salvarHorario } from "./actions";

type Org = { id: string; nome: string; monitor_hora: string | null };

const HORARIOS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** Configuração do Monitor Fiscal: em que horário (de Brasília) o robô consulta as notas todo dia. */
export default function HorarioMonitor({ organizacoes, admin }: { organizacoes: Org[]; admin: boolean }) {
  const [estado, acao, salvando] = useActionState(salvarHorario, undefined);
  const [org, setOrg] = useState(organizacoes[0]?.id ?? "");
  const atual = organizacoes.find((o) => o.id === org)?.monitor_hora?.slice(0, 5) ?? "11:00";
  return (
    <form action={acao} className="horario-monitor">
      {admin && (
        <select name="org_id" value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Organização">
          {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      )}
      <label htmlFor="mon-hora">Consultar todo dia às</label>
      <select id="mon-hora" name="hora" defaultValue={atual} key={org + atual}>
        {HORARIOS.map((h) => <option key={h} value={h}>{horaBR(h)}</option>)}
      </select>
      <button type="submit" className="secundario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar horário"}</button>
      <span className="suave">Horário de Brasília.</span>
      {estado && <span className={estado.erro ? "texto-erro" : "texto-ok"}>{estado.erro ?? estado.ok}</span>}
    </form>
  );
}

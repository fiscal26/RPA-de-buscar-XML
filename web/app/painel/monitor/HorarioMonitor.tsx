"use client";

import Escolha from "@/components/ui/Escolha";
import { useActionState } from "react";
import { horaBR } from "@/lib/monitor";
import { salvarHorario } from "./actions";

const HORARIOS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** Configuração do Monitor Fiscal: em que horário (de Brasília) o robô consulta as notas todo dia. */
export default function HorarioMonitor({ hora }: { hora: string | null }) {
  const [estado, acao, salvando] = useActionState(salvarHorario, undefined);
  return (
    <form action={acao} className="horario-monitor">
      <label htmlFor="mon-hora">Consultar todo dia às</label>
      <Escolha id="mon-hora" nome="hora" rotulo="Horário da consulta" padrao={(hora ?? "11:00").slice(0, 5)} busca={false} avatar={false} compacta
        opcoes={HORARIOS.map((h) => ({ id: h, titulo: horaBR(h) }))} />
      <button type="submit" className="secundario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar horário"}</button>
      <span className="suave">Horário de Brasília.</span>
      {estado && <span className={estado.erro ? "texto-erro" : "texto-ok"}>{estado.erro ?? estado.ok}</span>}
    </form>
  );
}

"use client";

import { useId, useState } from "react";

export default function PeriodoCompetencias({ competencia, minimo }: { competencia: string; minimo: string }) {
  const id = useId();
  const [inicio, setInicio] = useState(competencia);
  const [fim, setFim] = useState(competencia);
  return <fieldset className="periodo-competencias">
    <legend>Período de competências</legend>
    <div className="linha">
      <div><label htmlFor={`${id}-inicio`}>Mês inicial</label>
        <input id={`${id}-inicio`} name="competencia" type="month" min={minimo} value={inicio} required
          onChange={(e) => { setInicio(e.target.value); if (fim < e.target.value) setFim(e.target.value); }} /></div>
      <div><label htmlFor={`${id}-fim`}>Mês final</label>
        <input id={`${id}-fim`} name="competencia_final" type="month" min={inicio || minimo} value={fim} required
          onChange={(e) => setFim(e.target.value)} /></div>
    </div>
    <p className="suave">Para consultar um único mês, mantenha o mesmo mês nos dois campos.</p>
  </fieldset>;
}

"use client";

import Formulario from "@/components/ui/Formulario";

import Link from "next/link";
import { useActionState } from "react";
import { reprocessarErros } from "./reprocessar";

export default function ReprocessarErros({ id, empresas }: { id: string; empresas: number }) {
  const [estado, acao, pendente] = useActionState(reprocessarErros, undefined);
  if (estado?.id) return <p role="status">Reprocessamento criado. <Link href={`/painel/agendamentos/${estado.id}`}>Acompanhar</Link></p>;
  return <Formulario action={acao}>
    <input type="hidden" name="agendamento" value={id} />
    <button type="submit" className="botao-reprocessar" disabled={pendente}>
      {pendente ? "Agendando…" : `Reprocessar erros (${empresas})`}
    </button>
    {estado?.erro && <p className="faixa erro" role="alert">{estado.erro}</p>}
  </Formulario>;
}

"use client";

import { useActionState, useState } from "react";
import { renomearEmpresa } from "../actions";

/** Nome da empresa com o botão Renomear: o nome é corrigido (ex.: "lidi@ne silv4" vira "Lidiane Silva") e fica fixo. */
export default function Renomear({ id, nome, fixo }: { id: string; nome: string; fixo: boolean }) {
  const [editando, setEditando] = useState(false);
  const [estado, acao, enviando] = useActionState(async (anterior: Awaited<ReturnType<typeof renomearEmpresa>>, form: FormData) => {
    const r = await renomearEmpresa(anterior, form);
    if (r?.ok) setEditando(false);
    return r;
  }, undefined);
  if (!editando) {
    return (
      <span className="renomear">
        <span>{nome}{fixo && <span className="suave" title="Renomeado no portal: a planilha não troca este nome"> ✎</span>}</span>
        <button type="button" className="link-botao" onClick={() => setEditando(true)}>Renomear</button>
      </span>
    );
  }
  return (
    <form action={acao} className="renomear-form">
      <input type="hidden" name="id" value={id} />
      <input name="nome" type="text" defaultValue={nome} maxLength={60} required autoFocus aria-label="Nome da empresa" />
      <button type="submit" className="pequeno" disabled={enviando}>{enviando ? "Salvando…" : "Salvar"}</button>
      <button type="button" className="secundario pequeno" onClick={() => setEditando(false)}>Cancelar</button>
      {estado?.erro && <span className="erro-texto">{estado.erro}</span>}
    </form>
  );
}

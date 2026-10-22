"use client";

import { useActionState } from "react";
import Entrada from "@/components/Entrada";
import { CampoSenha } from "@/app/login/FormLogin";
import { salvarSenhaNova } from "./actions";

export default function RedefinirSenha() {
  const [estado, acao, enviando] = useActionState(salvarSenhaNova, undefined);
  return (
    <Entrada>
      <h1>Crie uma senha nova</h1>
      <p className="entrada-sub">Pelo menos 8 caracteres. Depois você entra com ela.</p>
      {estado?.erro && <div className="faixa erro">{estado.erro}</div>}
      <form action={acao} className="form-entrada">
        <label htmlFor="nova">Senha nova</label>
        <CampoSenha id="nova" nome="nova" autoComplete="new-password" minLength={8} />
        <label htmlFor="repetida">Repita a senha nova</label>
        <CampoSenha id="repetida" nome="repetida" autoComplete="new-password" minLength={8} />
        <button type="submit" className="grande" disabled={enviando}>{enviando ? "Salvando…" : "Salvar senha nova"}</button>
      </form>
    </Entrada>
  );
}

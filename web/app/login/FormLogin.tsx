"use client";

import { useActionState } from "react";
import { entrar } from "./actions";

export default function FormLogin() {
  const [estado, acao, enviando] = useActionState(entrar, undefined);
  return (
    <form action={acao}>
      {estado?.erro && <div className="faixa erro">{estado.erro}</div>}
      <label htmlFor="email">E-mail</label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="senha">Senha</label>
      <input id="senha" name="senha" type="password" autoComplete="current-password" required />
      <button type="submit" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}

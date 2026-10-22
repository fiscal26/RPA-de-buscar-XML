"use client";

import Link from "next/link";
import { useActionState } from "react";
import Entrada from "@/components/Entrada";
import { pedirLink } from "./actions";

export default function EsqueciSenha() {
  const [estado, acao, enviando] = useActionState(pedirLink, undefined);
  return (
    <Entrada>
      <h1>Esqueci minha senha</h1>
      <p className="entrada-sub">Informe o e-mail do seu acesso. Enviamos um link para você criar uma senha nova.</p>
      {estado && <div className={`faixa ${estado.erro ? "erro" : "ok"}`}>{estado.erro ?? estado.ok}</div>}
      <form action={acao} className="form-entrada">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <button type="submit" className="grande" disabled={enviando}>{enviando ? "Enviando…" : "Enviar o link"}</button>
      </form>
      <p className="entrada-voltar"><Link href="/login">Voltar para o login</Link></p>
    </Entrada>
  );
}

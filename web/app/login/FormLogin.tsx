"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import Icone from "@/components/Icones";
import { entrar } from "./actions";
import { CHAVE_ATIVIDADE } from "@/components/Inatividade";

export function CampoSenha({ id, nome, autoComplete, minLength }: { id: string; nome: string; autoComplete: string; minLength?: number }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="campo-senha">
      <input id={id} name={nome} type={ver ? "text" : "password"} autoComplete={autoComplete} minLength={minLength} required />
      <button type="button" className="botao-olho" onClick={() => setVer(!ver)} aria-label={ver ? "Esconder a senha" : "Mostrar a senha"}>
        <Icone nome={ver ? "olhoFechado" : "olho"} tamanho={20} />
      </button>
    </div>
  );
}

export default function FormLogin() {
  const [estado, acao, enviando] = useActionState(entrar, undefined);
  return (
    <form action={acao} className="form-entrada"
      onSubmit={() => { try { localStorage.setItem(CHAVE_ATIVIDADE, String(Date.now())); } catch {} }}>
      {estado?.erro && <div className="faixa erro">{estado.erro}</div>}
      <label htmlFor="email">E-mail</label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="senha">Senha</label>
      <CampoSenha id="senha" nome="senha" autoComplete="current-password" />
      <Link href="/esqueci-senha" className="link-esqueci">Esqueci minha senha</Link>
      <button type="submit" className="grande" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}

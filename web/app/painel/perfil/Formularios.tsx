"use client";

import { useActionState } from "react";
import { salvarAlertas, salvarNome, trocarMinhaSenha, type EstadoPerfil } from "./actions";

function Aviso({ estado }: { estado: EstadoPerfil }) {
  if (!estado) return null;
  return <div className={`faixa ${estado.erro ? "erro" : "ok"}`}>{estado.erro ?? estado.ok}</div>;
}

export function FormNome({ nome }: { nome: string }) {
  const [estado, acao, enviando] = useActionState(salvarNome, undefined);
  return (
    <form action={acao} className="formulario">
      <Aviso estado={estado} />
      <label htmlFor="nome">Nome</label>
      <input id="nome" name="nome" type="text" defaultValue={nome} required />
      <p><button type="submit" disabled={enviando} style={{ marginTop: "1rem" }}>{enviando ? "Salvando…" : "Salvar nome"}</button></p>
    </form>
  );
}

export function FormSenhaPropria() {
  const [estado, acao, enviando] = useActionState(trocarMinhaSenha, undefined);
  return (
    <form action={acao} className="formulario">
      <Aviso estado={estado} />
      <label htmlFor="atual">Senha atual</label>
      <input id="atual" name="atual" type="password" autoComplete="current-password" required />
      <label htmlFor="nova" style={{ marginTop: "0.9rem" }}>Senha nova</label>
      <input id="nova" name="nova" type="password" autoComplete="new-password" minLength={8} required />
      <label htmlFor="repetida" style={{ marginTop: "0.9rem" }}>Repita a senha nova</label>
      <input id="repetida" name="repetida" type="password" autoComplete="new-password" minLength={8} required />
      <p><button type="submit" disabled={enviando} style={{ marginTop: "1rem" }}>{enviando ? "Trocando…" : "Trocar senha"}</button></p>
    </form>
  );
}

export function FormAlertas({ ligado }: { ligado: boolean }) {
  const [estado, acao, enviando] = useActionState(salvarAlertas, undefined);
  return (
    <form action={acao} className="formulario">
      <Aviso estado={estado} />
      <label className="caixa-marcar">
        <input type="checkbox" name="alertas_mei" defaultChecked={ligado} />
        Receber por e-mail os alertas de limite dos MEIs do escritório
      </label>
      <p><button type="submit" disabled={enviando} style={{ marginTop: "1rem" }}>{enviando ? "Salvando…" : "Salvar"}</button></p>
    </form>
  );
}

"use client";

import BotaoConfirmar from "@/components/ui/BotaoConfirmar";
import Escolha from "@/components/ui/Escolha";
import Icone from "@/components/Icones";
import { useActionState, useRef } from "react";
import { criarEscritorio, criarPessoa, excluirEscritorio, excluirPessoa, trocarSenha, type EstadoEquipe } from "./actions";

type Org = { id: string; nome: string };

/** Senha provisória: digitada ou gerada aqui mesmo (12 caracteres, sem os que se confundem). */
function CampoSenha({ id, opcional = false }: { id: string; opcional?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  function gerar() {
    const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const n = crypto.getRandomValues(new Uint32Array(12));
    if (ref.current) ref.current.value = Array.from(n, (x) => letras[x % letras.length]).join("");
  }
  return (
    <div className="campo-com-botao">
      <input ref={ref} id={id} name="senha" type="text" minLength={8} required={!opcional} autoComplete="off" spellCheck={false} />
      <button type="button" className="secundario" onClick={gerar}>Gerar</button>
    </div>
  );
}

function Aviso({ estado }: { estado: EstadoEquipe }) {
  if (!estado) return null;
  return <div className={`faixa ${estado.erro ? "erro" : "ok"}`}>{estado.erro ?? estado.ok}</div>;
}

export function FormEscritorio() {
  const [estado, acao, enviando] = useActionState(criarEscritorio, undefined);
  return (
    <form action={acao} className="formulario">
      <Aviso estado={estado} />
      <div className="grade-campos">
        <div><label htmlFor="esc-nome">Escritório</label><input id="esc-nome" name="escritorio" type="text" required /></div>
        <div><label htmlFor="esc-doc">CNPJ (opcional)</label><input id="esc-doc" name="documento" type="text" inputMode="numeric" /></div>
        <div><label htmlFor="esc-gestor">Nome do gestor</label><input id="esc-gestor" name="nome" type="text" required /></div>
        <div><label htmlFor="esc-email">E-mail do gestor</label><input id="esc-email" name="email" type="email" required /></div>
        <div><label htmlFor="esc-senha">Senha provisória (opcional)</label><CampoSenha id="esc-senha" opcional /></div>
      </div>
      <button type="submit" disabled={enviando}>{enviando ? "Criando…" : "Criar escritório e gestor"}</button>
    </form>
  );
}

export function FormPessoa({ organizacoes }: { organizacoes?: Org[] }) {
  const [estado, acao, enviando] = useActionState(criarPessoa, undefined);
  return (
    <form action={acao} className="formulario">
      <Aviso estado={estado} />
      <div className="grade-campos">
        {organizacoes && (
          <>
            <div>
              <label htmlFor="p-org">Escritório</label>
              <Escolha id="p-org" nome="org_id" rotulo="Escritório" placeholder="Escolha o escritório…"
                opcoes={organizacoes.map((o) => ({ id: o.id, titulo: o.nome }))} />
            </div>
            <div>
              <label htmlFor="p-papel">Papel</label>
              <Escolha id="p-papel" nome="papel" rotulo="Papel" padrao="usuario" avatar={false} opcoes={[
                { id: "usuario", titulo: "Colaborador", sub: "Usa o portal do escritório" },
                { id: "gestor", titulo: "Gestor", sub: "Também cadastra a equipe" }]} />
            </div>
          </>
        )}
        <div><label htmlFor="p-nome">Nome</label><input id="p-nome" name="nome" type="text" required /></div>
        <div><label htmlFor="p-email">E-mail</label><input id="p-email" name="email" type="email" required /></div>
        <div><label htmlFor="p-senha">Senha provisória (opcional)</label><CampoSenha id="p-senha" opcional /></div>
      </div>
      <button type="submit" disabled={enviando}>{enviando ? "Criando…" : organizacoes ? "Criar acesso" : "Criar acesso do colaborador"}</button>
    </form>
  );
}

export function FormSenha({ id }: { id: string }) {
  const [estado, acao, enviando] = useActionState(trocarSenha, undefined);
  return (
    <form action={acao} className="formulario compacto-senha">
      <input type="hidden" name="id" value={id} />
      <CampoSenha id={`senha-${id}`} />
      <button type="submit" className="pequeno" disabled={enviando}>{enviando ? "Salvando…" : "Definir senha"}</button>
      <Aviso estado={estado} />
    </form>
  );
}

/** Excluir uma pessoa: pede confirmação e apaga o acesso de vez. */
export function ExcluirPessoa({ id, nome }: { id: string; nome: string }) {
  const [estado, acao, enviando] = useActionState(excluirPessoa, undefined);
  return (
    <form action={acao}>
      <input type="hidden" name="id" value={id} />
      <BotaoConfirmar className="perigo botao-icone" desativado={enviando} rotulo={`Excluir o acesso de ${nome}`}
        dica={enviando ? "Excluindo…" : "Excluir"} titulo={`Excluir o acesso de ${nome}?`}
        texto="A pessoa não consegue mais entrar. Para só bloquear por um tempo, use Desativar.">
        <Icone nome="lixeira" tamanho={18} />
      </BotaoConfirmar>
      {estado?.erro && <span className="erro-texto">{estado.erro}</span>}
    </form>
  );
}

/** Excluir o escritório inteiro: só com o nome digitado. */
export function ExcluirEscritorio({ id, nome }: { id: string; nome: string }) {
  const [estado, acao, enviando] = useActionState(excluirEscritorio, undefined);
  const campo = useRef<HTMLInputElement>(null);
  return (
    <form action={acao} onSubmit={(e) => {
      const digitado = prompt(`Excluir o escritório ${nome} de vez? Saem as pessoas, as empresas, os logins do ATF, os agendamentos `
        + `e o Monitoramento MEI. Os arquivos já salvos no PC do robô ficam.\n\nPara confirmar, digite o nome do escritório:`);
      if (!digitado) { e.preventDefault(); return; }
      if (campo.current) campo.current.value = digitado;
    }}>
      <input type="hidden" name="id" value={id} />
      <input ref={campo} type="hidden" name="confirmacao" />
      <button type="submit" className="perigo botao-icone" disabled={enviando} aria-label={`Excluir o escritório ${nome}`}
        data-dica={enviando ? "Excluindo…" : "Excluir escritório"}>
        <Icone nome="lixeira" tamanho={18} />
      </button>
      {estado?.erro && <span className="erro-texto">{estado.erro}</span>}
    </form>
  );
}

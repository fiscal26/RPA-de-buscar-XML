"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Sem usar o portal por este tempo, a sessão é encerrada (com aviso antes). */
export const MINUTOS_INATIVIDADE = 15;
const AVISO_SEGUNDOS = 120;
export const CHAVE_ATIVIDADE = "lv_ultima_atividade";  // compartilhada entre as abas abertas

const ler = () => { try { return Number(localStorage.getItem(CHAVE_ATIVIDADE)) || 0; } catch { return 0; } };
const gravar = (t: number) => { try { localStorage.setItem(CHAVE_ATIVIDADE, String(t)); } catch {} };

/**
 * Encerra a sessão depois de MINUTOS_INATIVIDADE sem clique, tecla ou rolagem em nenhuma aba.
 * A atualização automática das telas não conta como uso. Vale também para a aba esquecida aberta
 * de um dia para o outro: ao voltar, a sessão já sai.
 */
export default function Inatividade() {
  const [restam, setRestam] = useState<number | null>(null);
  const ultimaGravacao = useRef(0);

  const encerrar = useCallback(() => {
    try { localStorage.removeItem(CHAVE_ATIVIDADE); } catch {}
    window.location.href = "/sair?motivo=inatividade";
  }, []);

  const marcar = useCallback(() => {
    const agora = Date.now();
    if (agora - ultimaGravacao.current < 10_000) return;  // grava no máximo a cada 10 s
    ultimaGravacao.current = agora;
    gravar(agora);
    setRestam(null);
  }, []);

  useEffect(() => {
    const limite = MINUTOS_INATIVIDADE * 60_000;
    const inicio = ler();
    if (inicio && Date.now() - inicio >= limite) { encerrar(); return; }
    if (!inicio) gravar(Date.now());

    const conferir = () => {
      const parado = Date.now() - ler();
      if (parado >= limite) encerrar();
      else if (parado >= limite - AVISO_SEGUNDOS * 1000) setRestam(Math.ceil((limite - parado) / 1000));
      else setRestam(null);
    };
    const eventos = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    document.addEventListener("visibilitychange", conferir);
    const relogio = setInterval(conferir, 1000);
    return () => {
      eventos.forEach((e) => window.removeEventListener(e, marcar));
      document.removeEventListener("visibilitychange", conferir);
      clearInterval(relogio);
    };
  }, [encerrar, marcar]);

  if (restam === null) return null;
  const mm = Math.floor(restam / 60), ss = String(restam % 60).padStart(2, "0");
  return (
    <div className="inatividade-fundo" role="alertdialog" aria-modal="true" aria-labelledby="inatividade-titulo">
      <div className="inatividade-caixa">
        <h2 id="inatividade-titulo">Ainda está por aí?</h2>
        <p>Por segurança, a sessão será encerrada por inatividade em <b>{mm}:{ss}</b>.</p>
        <button type="button" className="grande" autoFocus onClick={() => { ultimaGravacao.current = 0; marcar(); }}>
          Continuar conectado
        </button>
      </div>
    </div>
  );
}

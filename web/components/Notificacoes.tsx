"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Icone from "./Icones";

type Aviso = { id: string; tipo: string; gravidade: "erro" | "alerta"; titulo: string; texto: string; link: string; quando: string | null };

const CHAVE = "notificacoes-vistas";
const TIPO: Record<string, string> = { acao: "Precisa da sua ação", mei: "Monitoramento MEI", certificado: "Certificado", robo: "Robô",
  monitor: "Monitor Fiscal", nfe: "Monitor Fiscal" };

function vistas(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE) ?? "[]") as string[]); } catch { return new Set(); }
}

/** Sino da barra do painel: os avisos que pedem atenção (empresas com pendência, MEIs no limite, certificados
 *  vencendo, robô desligado). O número mostra os que a pessoa ainda não viu neste navegador. */
export default function Notificacoes() {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [vistos, setVistos] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const caminho = usePathname();

  const carregar = useCallback(() => {
    fetch("/api/notificacoes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { avisos: [] }))
      .then((d: { avisos: Aviso[] }) => setAvisos(d.avisos ?? []))
      .catch(() => setAvisos([]));
  }, []);

  useEffect(() => { setVistos(vistas()); }, []);
  useEffect(() => { carregar(); }, [carregar, caminho]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  const novos = (avisos ?? []).filter((a) => !vistos.has(a.id)).length;

  function abrir() {
    const abrindo = !aberto;
    setAberto(abrindo);
    if (abrindo && avisos?.length) {  // abrir marca como vistos (guarda só os que ainda existem)
      const ids = avisos.map((a) => a.id);
      try { localStorage.setItem(CHAVE, JSON.stringify(ids)); } catch {}
      setTimeout(() => setVistos(new Set(ids)), 1500);
    }
  }

  return (
    <div className="notificacoes" ref={caixa}>
      <button type="button" className="sino-botao" aria-expanded={aberto} aria-haspopup="dialog" onClick={abrir}
        aria-label={novos ? `Notificações: ${novos} nova${novos > 1 ? "s" : ""}` : "Notificações"} title="Notificações">
        <Icone nome="sino" tamanho={20} />
        {novos > 0 && <span className="sino-contador" aria-hidden="true">{novos > 99 ? "99+" : novos}</span>}
      </button>
      {aberto && (
        <div className="notificacoes-painel" role="dialog" aria-label="Notificações">
          <div className="notificacoes-topo">
            <b>Notificações</b>
            <span className="suave">{avisos?.length ? `${avisos.length} aviso${avisos.length > 1 ? "s" : ""}` : ""}</span>
          </div>
          {avisos === null ? (
            <p className="suave notificacoes-vazio">Carregando…</p>
          ) : !avisos.length ? (
            <p className="suave notificacoes-vazio">Tudo em dia. Nenhum aviso agora.</p>
          ) : (
            <ul>
              {avisos.map((a) => (
                <li key={a.id} className={vistos.has(a.id) ? "" : "nova"}>
                  <Link href={a.link} onClick={() => setAberto(false)}>
                    <span className={`notificacao-sinal ${a.gravidade}`} aria-hidden="true">!</span>
                    <span className="notificacao-texto">
                      <small>{TIPO[a.tipo] ?? "Aviso"}</small>
                      <b>{a.titulo}</b>
                      <span>{a.texto}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Icone from "./Icones";
import usePainelFlutuante from "./ui/usePainelFlutuante";

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
  const p = usePainelFlutuante<HTMLButtonElement>();
  const [erro, setErro] = useState(false);
  const caminho = usePathname();

  const carregar = useCallback(() => {
    setErro(false);
    return fetch("/api/notificacoes", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("Falha ao carregar avisos"); return r.json(); })
      .then((d: { avisos: Aviso[] }) => setAvisos(d.avisos ?? []))
      .catch(() => setErro(true));
  }, []);

  useEffect(() => { setVistos(vistas()); }, []);
  useEffect(() => { carregar(); }, [carregar, caminho]);
  useEffect(() => {
    window.addEventListener("notificacoes:atualizar", carregar);
    return () => window.removeEventListener("notificacoes:atualizar", carregar);
  }, [carregar]);
  const novos = (avisos ?? []).filter((a) => !vistos.has(a.id)).length;

  function abrir() {
    const abrindo = !p.aberto;
    p.setAberto(abrindo);
    if (abrindo) void carregar();
  }
  useEffect(() => {
    if (!p.aberto || !avisos?.length) return;
    const t = setTimeout(() => {
      const ids = avisos.map((a) => a.id);
      try { localStorage.setItem(CHAVE, JSON.stringify(ids)); } catch {}
      setVistos(new Set(ids));
    }, 1500);
    return () => clearTimeout(t);
  }, [p.aberto, avisos]);

  return (
    <div className="notificacoes" style={p.estilo}>
      <button ref={p.gatilho} type="button" className="sino-botao" aria-expanded={p.aberto} aria-controls={p.id} onClick={abrir}
        aria-label={novos ? `Notificações: ${novos} nova${novos > 1 ? "s" : ""}` : "Notificações"} title="Notificações">
        <Icone nome="sino" tamanho={20} />
        {novos > 0 && <span className="sino-contador" aria-hidden="true">{novos > 99 ? "99+" : novos}</span>}
      </button>
      <div {...p.painelProps} ref={p.painel} className="notificacoes-painel painel-flutuante" aria-label="Notificações">
          <div className="notificacoes-topo">
            <b>Notificações</b>
            <span className="suave">{avisos?.length ? `${avisos.length} aviso${avisos.length > 1 ? "s" : ""}` : ""}</span>
          </div>
          {erro ? <div className="notificacoes-vazio"><p role="status">Não foi possível atualizar os avisos.</p><button type="button" className="secundario" onClick={() => void carregar()}>Tentar novamente</button></div> : avisos === null ? (
            <p className="suave notificacoes-vazio">Carregando…</p>
          ) : !avisos.length ? (
            <p className="suave notificacoes-vazio">Tudo em dia. Nenhum aviso agora.</p>
          ) : (
            <ul>
              {avisos.map((a) => (
                <li key={a.id} className={vistos.has(a.id) ? "" : "nova"}>
                  <Link href={a.link} onClick={() => p.setAberto(false)}>
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
        <button type="button" className="notificacoes-fechar secundario" onClick={() => { p.setAberto(false); p.gatilho.current?.focus(); }}>Fechar notificações</button>
        </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Icone from "./Icones";

type Convite = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type NavegadorInstalavel = Navigator & { install?: () => Promise<unknown> };

/** Instalação é oferecida somente quando o próprio navegador permite o convite. */
export default function InstalarApp() {
  const convite = useRef<Convite | null>(null);
  const [disponivel, setDisponivel] = useState(false);
  const [instalado, setInstalado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  useEffect(() => {
    setInstalado(matchMedia("(display-mode: standalone)").matches);
    setDisponivel(typeof (navigator as NavegadorInstalavel).install === "function");
    const receber = (e: Event) => { e.preventDefault(); convite.current = e as Convite; setDisponivel(true); };
    const concluir = () => { convite.current = null; setInstalado(true); setDisponivel(false); setMensagem("Aplicativo instalado."); };
    window.addEventListener("beforeinstallprompt", receber);
    window.addEventListener("appinstalled", concluir);
    return () => { window.removeEventListener("beforeinstallprompt", receber); window.removeEventListener("appinstalled", concluir); };
  }, []);
  async function instalar() {
    if (ocupado) return;
    const n = navigator as NavegadorInstalavel;
    const evento = convite.current;
    if (!n.install && !evento) return;
    convite.current = null; setOcupado(true); setDisponivel(false);
    try {
      if (n.install) { await n.install(); setMensagem("Confira a confirmação do navegador."); }
      else if (evento) { await evento.prompt(); const escolha = await evento.userChoice;
        setMensagem(escolha.outcome === "accepted" ? "Instalação solicitada ao navegador." : "Você pode continuar usando o portal pelo navegador."); }
    } catch { setMensagem("A instalação não foi concluída. Você pode usar o menu do navegador."); }
    finally { setOcupado(false); }
  }
  return <details className="instalar-app"><summary><Icone nome="inicio" tamanho={18} />Usar como aplicativo</summary>
    <div className="instalar-ajuda">
      <p>{instalado ? "O LotiVisse já está aberto como aplicativo." : "Abra o LotiVisse em uma janela própria, com um ícone na sua tela inicial."}</p>
      {!instalado && <>
        {(disponivel || ocupado) && <button type="button" className="secundario" aria-disabled={ocupado} onClick={() => void instalar()}>Instalar LotiVisse</button>}
        <p>No Chrome ou Edge, procure “Instalar aplicativo” no menu do navegador. No Safari do iPhone, use Compartilhar → Adicionar à Tela de Início.</p>
        <p className="suave">O portal precisa de internet para consultar e agendar documentos.</p>
      </>}
      <p role="status">{mensagem}</p>
    </div>
  </details>;
}

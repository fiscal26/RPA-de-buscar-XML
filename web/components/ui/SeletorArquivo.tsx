"use client";

import { useEffect, useRef, useState } from "react";
import Icone from "@/components/Icones";

const tamanho = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Campo de arquivo da marca: clique ou arraste o arquivo; depois de escolhido, mostra o nome e o tamanho. */
export default function SeletorArquivo({ nome, aceita, obrigatorio, titulo, dica, id }: {
  nome: string; aceita?: string; obrigatorio?: boolean; titulo: string; dica?: string; id?: string;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [sobre, setSobre] = useState(false);
  useEffect(() => {
    const form = campo.current?.closest("form");
    if (!form) return;
    const limpar = () => setArquivo(null);
    form.addEventListener("reset", limpar);
    return () => form.removeEventListener("reset", limpar);
  }, []);
  return (
    <label className={`seletor${arquivo ? " escolhido" : ""}${sobre ? " ativo" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault(); setSobre(false);
        if (!e.dataTransfer.files.length || !campo.current) return;
        campo.current.files = e.dataTransfer.files;
        setArquivo(e.dataTransfer.files[0]);
      }}>
      <Icone nome={arquivo ? "visto" : "arquivo"} tamanho={22} />
      <span className="seletor-texto">
        <b>{arquivo ? arquivo.name : titulo}</b>
        <small>{arquivo ? `${tamanho(arquivo.size)} · clique para trocar` : dica ?? "Clique para escolher ou arraste o arquivo para cá"}</small>
      </span>
      <input ref={campo} id={id} type="file" name={nome} accept={aceita} required={obrigatorio}
        onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
    </label>
  );
}

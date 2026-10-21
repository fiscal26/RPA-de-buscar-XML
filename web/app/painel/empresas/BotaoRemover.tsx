"use client";

/** Pede confirmação antes de apagar a empresa (e a senha guardada). */
export default function BotaoRemover({ apelido }: { apelido: string }) {
  return (
    <button
      type="submit"
      className="perigo pequeno"
      onClick={(e) => {
        if (!confirm(`Remover ${apelido} e a senha do ATF guardada?`)) e.preventDefault();
      }}
    >
      Remover
    </button>
  );
}

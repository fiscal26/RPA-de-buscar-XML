/** Símbolo da LotiVisse: o "V" vira o visto do contador (o tique de conferido), traçado em marca-texto. */
export default function Simbolo({ tamanho = 30 }: { tamanho?: number }) {
  return (
    <svg className="simbolo" width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#13294b" />
      <path d="M8.2 16.4 13.6 22 24.4 9.6" fill="none" stroke="#f6d35b" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

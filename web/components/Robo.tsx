/** O robô da LotiVisse, em miniatura: visor escuro com olhos de marca-texto, segurando uma pasta. */
export default function Robo({ tamanho = 150 }: { tamanho?: number }) {
  return (
    <svg className="robo" width={tamanho} height={tamanho * 1.12} viewBox="0 0 150 168" role="img" aria-label="Robô da LotiVisse">
      {/* antena */}
      <line x1="75" y1="10" x2="75" y2="28" stroke="#c9d6e8" strokeWidth="4" strokeLinecap="round" />
      <circle className="robo-luz" cx="75" cy="9" r="6.5" fill="#f6d35b" />
      {/* orelhas */}
      <rect x="18" y="46" width="10" height="24" rx="4" fill="#9fb3cf" />
      <rect x="122" y="46" width="10" height="24" rx="4" fill="#9fb3cf" />
      {/* cabeça e visor */}
      <rect x="26" y="26" width="98" height="64" rx="20" fill="#e6edf7" />
      <rect x="38" y="38" width="74" height="40" rx="13" fill="#13294b" />
      <rect className="robo-olho" x="52" y="50" width="13" height="16" rx="6" fill="#f6d35b" />
      <rect className="robo-olho" x="85" y="50" width="13" height="16" rx="6" fill="#f6d35b" />
      {/* pescoço e corpo */}
      <rect x="64" y="90" width="22" height="8" rx="3" fill="#9fb3cf" />
      <rect x="34" y="97" width="82" height="52" rx="16" fill="#c9d6e8" />
      <circle cx="54" cy="113" r="4" fill="#13294b" opacity="0.35" />
      <circle cx="96" cy="113" r="4" fill="#13294b" opacity="0.35" />
      {/* braços segurando a pasta */}
      <rect x="20" y="104" width="16" height="30" rx="8" fill="#9fb3cf" />
      <rect x="114" y="104" width="16" height="30" rx="8" fill="#9fb3cf" />
      <path d="M48 118h18l5 5h31a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H48a4 4 0 0 1-4-4v-31a4 4 0 0 1 4-4z" fill="#f6d35b" />
      <rect x="52" y="133" width="34" height="4" rx="2" fill="#13294b" opacity="0.5" />
      <rect x="52" y="142" width="22" height="4" rx="2" fill="#13294b" opacity="0.5" />
      {/* rodinhas */}
      <rect x="44" y="150" width="20" height="14" rx="7" fill="#9fb3cf" />
      <rect x="86" y="150" width="20" height="14" rx="7" fill="#9fb3cf" />
    </svg>
  );
}

import Simbolo from "./Simbolo";

/** Logotipo: o símbolo (o visto) e "Loti" + "Visse", com o traço de marca-texto sob o V. */
export default function Logo({ grande = false, simbolo = true }: { grande?: boolean; simbolo?: boolean }) {
  return (
    <span className={`logo${grande ? " logo-grande" : ""}`} aria-label="LotiVisse">
      {simbolo && <Simbolo tamanho={grande ? 38 : 30} />}
      <span className="logo-nome">Loti<span className="logo-v">Visse</span></span>
    </span>
  );
}

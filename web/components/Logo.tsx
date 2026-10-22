/** Logotipo em texto: "Loti" + "Visse". O V carrega o traço de marca-texto da marca. */
export default function Logo({ grande = false }: { grande?: boolean }) {
  return (
    <span className={`logo${grande ? " logo-grande" : ""}`} aria-label="LotiVisse">
      Loti<span className="logo-v">Visse</span>
    </span>
  );
}

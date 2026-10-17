/** Logotipo em texto: "Loti" + "Visse", com o V em destaque. */
export default function Logo({ grande = false }: { grande?: boolean }) {
  return (
    <span className={`logo${grande ? " logo-grande" : ""}`} aria-label="LotiVisse">
      Loti<span className="logo-v">Visse</span>
    </span>
  );
}

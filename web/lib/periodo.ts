export function erroPeriodo(inicio: string, fim: string, minimo: string, agora = new Date()): string | null {
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!mes.test(inicio) || !mes.test(fim)) return "Escolha os meses inicial e final.";
  if (inicio > fim) return "O mês final deve ser igual ou posterior ao inicial.";
  if (inicio < minimo) return `O período deve começar a partir de ${minimo.slice(5)}/${minimo.slice(0, 4)}.`;
  const atual = agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  if (fim > atual) return "O período contém uma competência que ainda não começou.";
  return null;
}

export function competenciasPeriodo(inicio: string, fim: string): string[] {
  const formato = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!formato.test(inicio) || !formato.test(fim) || inicio > fim) return [];
  const [ano, mes] = inicio.split("-").map(Number), [anoFim, mesFim] = fim.split("-").map(Number);
  return Array.from({ length: (anoFim - ano) * 12 + mesFim - mes + 1 }, (_, i) => {
    const indice = mes - 1 + i;
    return `${ano + Math.floor(indice / 12)}-${String(indice % 12 + 1).padStart(2, "0")}`;
  });
}

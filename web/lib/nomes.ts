/**
 * Corrige nomes digitados na planilha ou no portal: "lidi@ne silv4" vira "Lidiane Silva".
 * - número ou símbolo no MEIO de uma palavra é letra trocada (@ e 4 = a, 3 = e, 1 = i, 0 = o, 5 e $ = s, 7 = t);
 *   número sozinho ("Posto 2000") ou palavra com uma letra só ("3M") fica como está;
 * - espaços repetidos saem; maiúscula no começo de cada palavra;
 * - de, da, do, das, dos, e ficam minúsculas; siglas de empresa (LTDA, ME, EPP, MEI, EIRELI, S/A) maiúsculas.
 */
const LETRA = /\p{L}/u;
const TROCA: Record<string, string> = { "@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", "$": "s", "7": "t" };
const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du", "del", "van", "von"]);
const SIGLAS_MAIUSCULAS = new Set(["ltda", "me", "epp", "mei", "eireli", "sa", "s/a", "s.a.", "s.a", "ss", "slu", "ltda.", "me.", "epp."]);

function desfazerTrocas(palavra: string): string {
  const letras = [...palavra].filter((c) => LETRA.test(c)).length;
  if (letras < 2) return palavra;  // "2000", "3M": não é letra trocada
  const chars = [...palavra];
  return chars.map((c, i) => {
    const troca = TROCA[c];
    if (!troca) return c;
    // só troca se encostar numa letra (antes ou depois), como em "silv4" ou "lidi@ne"
    const vizinhaLetra = LETRA.test(chars[i - 1] ?? "") || LETRA.test(chars[i + 1] ?? "");
    return vizinhaLetra ? troca : c;
  }).join("");
}

function capitalizar(palavra: string, primeira: boolean): string {
  const baixa = palavra.toLocaleLowerCase("pt-BR");
  if (SIGLAS_MAIUSCULAS.has(baixa)) return baixa.toLocaleUpperCase("pt-BR");
  if (!primeira && MINUSCULAS.has(baixa)) return baixa;
  // partes separadas por hífen ou apóstrofo: "Ana-Clara", "D'Ávila"
  return baixa.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toLocaleUpperCase("pt-BR"));
}

export function corrigirNome(texto: string, limite = 60): string {
  // sem =, +, - ou @ no começo: o nome vai para planilhas do Excel e não pode virar fórmula
  const palavras = String(texto ?? "").normalize("NFC").replace(/[\u0000-\u001f]/g, " ").trim().replace(/^[=+\-@\s]+/, "")
    .split(/\s+/).filter(Boolean);
  return palavras.map((p, i) => {
    if (/\d/.test(p) && [...p].filter((c) => LETRA.test(c)).length < 2) return p.toLocaleUpperCase("pt-BR");  // "3M", "2000"
    return capitalizar(desfazerTrocas(p), i === 0);
  }).join(" ").slice(0, limite).trim();
}

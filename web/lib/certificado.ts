import "server-only";
import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import forge from "node-forge";
import { cnpjValido, cpfValido, soDigitos } from "@/lib/documentos";

/** cnpj: do e-CNPJ; cpf: do e-CPF (contador, para o certificado do escritório com procuração). */
export type DadosCertificado = { cnpj: string; cpf: string; nome: string; validade: string | null };

export const TAMANHO_MAXIMO = 64 * 1024; // um A1 tem poucos KB

/** Abre o .pfx com a senha (só na memória do servidor, durante o envio) e lê o CNPJ, o nome e a validade.
 *  No e-CNPJ o nome do titular termina com o CNPJ: "EMPRESA LTDA:12345678000199". */
export function lerCertificado(pfx: Buffer, senha: string): DadosCertificado {
  let der: Buffer | null | undefined;
  try {
    const contexto = createSecureContext({ pfx, passphrase: senha });
    // o certificado do titular, dentro do contexto TLS criado com o .pfx
    der = (contexto as unknown as { context?: { getCertificate?: () => Buffer | null } }).context?.getCertificate?.();
  } catch (e) {
    const msg = String((e as Error).message ?? "");
    // "Unsupported PKCS12 PFX data": cifra antiga (RC2-40), comum nos A1 emitidos pelas ACs e aceita pelo Windows,
    // mas desligada no OpenSSL 3 do servidor. Lê com a biblioteca forge, que entende esse formato.
    if (/unsupported/i.test(msg)) der = certificadoLegado(pfx, senha);
    else if (/mac verify|bad decrypt|wrong password|pkcs12/i.test(msg)) throw new Error("A senha não abre este certificado.");
    else throw new Error("Não consegui abrir o arquivo: confira se é um certificado A1 (.pfx ou .p12).");
  }
  if (!der) return { cnpj: "", cpf: "", nome: "", validade: null };
  const cert = new X509Certificate(der);
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(cert.subject)?.[1]?.trim() ?? "";
  const [nome, final] = cn.includes(":") ? [cn.slice(0, cn.lastIndexOf(":")), cn.slice(cn.lastIndexOf(":") + 1)] : [cn, ""];
  const doc = soDigitos(final);
  let cnpj = cnpjValido(doc) ? doc : "";
  if (!cnpj && doc.length !== 11) cnpj = (cert.subject.match(/\d{14}/g) ?? []).find(cnpjValido) ?? "";
  const cpf = !cnpj && cpfValido(doc) ? doc : "";
  const validade = Number.isNaN(Date.parse(cert.validTo)) ? null : new Date(cert.validTo).toISOString();
  return { cnpj, cpf, nome: nome.trim().slice(0, 120), validade };
}

/** .pfx com cifra antiga: abre com a forge e devolve o certificado do titular (o que tem a chave privada) em DER. */
function certificadoLegado(pfx: Buffer, senha: string): Buffer {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary"))), false, senha);
  } catch (e) {
    if (/mac|password|invalid|decrypt/i.test(String((e as Error).message ?? ""))) throw new Error("A senha não abre este certificado.");
    throw new Error("Não consegui abrir o arquivo: confira se é um certificado A1 (.pfx ou .p12).");
  }
  const oids = forge.pki.oids;
  const chaves = [...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? [])]
    .map((b) => b.key as forge.pki.rsa.PrivateKey | undefined).filter((k): k is forge.pki.rsa.PrivateKey => !!k);
  const certs = (p12.getBags({ bagType: oids.certBag })[oids.certBag] ?? [])
    .map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  if (!chaves.length || !certs.length) throw new Error("O arquivo .pfx não tem a chave do certificado (precisa ser um A1 completo).");
  const doTitular = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return chaves.some((k) => k.n && pub.n && k.n.equals(pub.n));
  }) ?? certs[0];
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(doTitular)).getBytes(), "binary");
}

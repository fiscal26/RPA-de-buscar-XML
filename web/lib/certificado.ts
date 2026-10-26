import "server-only";
import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { cnpjValido, soDigitos } from "@/lib/documentos";

export type DadosCertificado = { cnpj: string; nome: string; validade: string | null };

export const TAMANHO_MAXIMO = 64 * 1024; // um A1 tem poucos KB

/** Abre o .pfx com a senha (só na memória do servidor, durante o envio) e lê o CNPJ, o nome e a validade.
 *  No e-CNPJ o nome do titular termina com o CNPJ: "EMPRESA LTDA:12345678000199". */
export function lerCertificado(pfx: Buffer, senha: string): DadosCertificado {
  let contexto;
  try {
    contexto = createSecureContext({ pfx, passphrase: senha });
  } catch (e) {
    const msg = String((e as Error).message ?? "");
    if (/mac verify|bad decrypt|wrong password|pkcs12/i.test(msg)) throw new Error("A senha não abre este certificado.");
    if (/unsupported/i.test(msg)) {
      throw new Error("Este .pfx usa uma cifra antiga. Exporte o certificado de novo (no Windows: certmgr > Exportar, com a opção AES-256) e envie.");
    }
    throw new Error("Não consegui abrir o arquivo: confira se é um certificado A1 (.pfx ou .p12).");
  }
  // o certificado do titular, dentro do contexto TLS criado com o .pfx
  const der = (contexto as unknown as { context?: { getCertificate?: () => Buffer | null } }).context?.getCertificate?.();
  if (!der) return { cnpj: "", nome: "", validade: null };
  const cert = new X509Certificate(der);
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(cert.subject)?.[1]?.trim() ?? "";
  const [nome, final] = cn.includes(":") ? [cn.slice(0, cn.lastIndexOf(":")), cn.slice(cn.lastIndexOf(":") + 1)] : [cn, ""];
  let cnpj = soDigitos(final);
  if (!cnpjValido(cnpj)) cnpj = (cert.subject.match(/\d{14}/g) ?? []).find(cnpjValido) ?? "";
  const validade = Number.isNaN(Date.parse(cert.validTo)) ? null : new Date(cert.validTo).toISOString();
  return { cnpj, nome: nome.trim().slice(0, 120), validade };
}

import "server-only";
import { constants, createCipheriv, publicEncrypt, randomBytes } from "node:crypto";

function chavePublica(): string {
  const bruta = (process.env.XML_CHAVE_PUBLICA ?? "").trim();
  if (!bruta) throw new Error("A chave pública do robô (XML_CHAVE_PUBLICA) não foi configurada no portal.");
  // aceita o PEM como o robô mostra (base64 numa linha) ou o PEM com as quebras de linha
  return bruta.startsWith("-----BEGIN") ? bruta.replace(/\\n/g, "\n") : Buffer.from(bruta, "base64").toString("utf8");
}

const rsa = (dados: Buffer) =>
  publicEncrypt({ key: chavePublica(), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, dados);

/** Cifra a senha do ATF com a chave pública do robô (RSA-OAEP, SHA-256). Só o robô, com a chave
 *  privada no PC, consegue abrir: a senha nunca fica legível no banco, na Vercel nem nos logs.
 *  Formato "v1:<base64>", o mesmo que o robô lê (robo/cripto.py). */
export function cifrarSenha(senha: string): string {
  return `v1:${rsa(Buffer.from(senha, "utf8")).toString("base64")}`;
}

/** Arquivo inteiro (o certificado A1 .pfx): grande demais para o RSA sozinho, vai em AES-256-GCM com
 *  uma chave nova a cada arquivo, e essa chave vai cifrada pelo RSA do robô.
 *  Formato "v2:<chave AES cifrada>.<iv>.<arquivo cifrado + tag>" (base64), o mesmo de robo/cripto.py. */
export function cifrarArquivo(dados: Buffer): string {
  const chave = randomBytes(32);
  const iv = randomBytes(12);
  const aes = createCipheriv("aes-256-gcm", chave, iv);
  const cifrado = Buffer.concat([aes.update(dados), aes.final(), aes.getAuthTag()]);
  return `v2:${rsa(chave).toString("base64")}.${iv.toString("base64")}.${cifrado.toString("base64")}`;
}

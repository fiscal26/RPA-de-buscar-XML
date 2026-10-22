import "server-only";
import { constants, publicEncrypt } from "node:crypto";

/** Cifra a senha do ATF com a chave pública do robô (RSA-OAEP, SHA-256). Só o robô, com a chave
 *  privada no PC, consegue abrir: a senha nunca fica legível no banco, na Vercel nem nos logs.
 *  Formato "v1:<base64>", o mesmo que o robô lê (robo/cripto.py). */
export function cifrarSenha(senha: string): string {
  const bruta = (process.env.XML_CHAVE_PUBLICA ?? "").trim();
  if (!bruta) throw new Error("A chave pública do robô (XML_CHAVE_PUBLICA) não foi configurada no portal.");
  // aceita o PEM como o robô mostra (base64 numa linha) ou o PEM com as quebras de linha
  const pem = bruta.startsWith("-----BEGIN") ? bruta.replace(/\\n/g, "\n") : Buffer.from(bruta, "base64").toString("utf8");
  const cifrada = publicEncrypt(
    { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(senha, "utf8"),
  );
  return `v1:${cifrada.toString("base64")}`;
}

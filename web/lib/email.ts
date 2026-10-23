import "server-only";
import { headers } from "next/headers";
import { MARCA } from "@/lib/marca";
import { clienteAdmin } from "@/lib/supabase/admin";

/**
 * E-mails do portal pela API da Brevo (transacional). Variáveis na Vercel:
 *   BREVO_API_KEY          chave de API (Brevo > SMTP & API > API Keys)
 *   EMAIL_REMETENTE        endereço verificado na Brevo (ex.: avisos@lotivisse.com.br)
 *   EMAIL_REMETENTE_NOME   nome que aparece (padrão: LotiVisse)
 */
export const emailConfigurado = () => !!(process.env.BREVO_API_KEY && process.env.EMAIL_REMETENTE);

/** O endereço do remetente, aceitando também "LotiVisse <avisos@...>", aspas ou espaços colados junto. */
export function remetente(): string | null {
  const bruto = (process.env.EMAIL_REMETENTE ?? "").trim().replace(/^["']|["']$/g, "");
  const email = (bruto.match(/<([^>]+)>/)?.[1] ?? bruto).trim().toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/.test(email) ? email : null;
}

export type Email = { para: { email: string; nome?: string }; assunto: string; titulo: string; paragrafos: string[];
  botao?: { texto: string; url: string }; rodape?: string };

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Corpo em HTML simples (funciona no Gmail, Outlook e no celular) e a versão em texto. */
function montar(e: Email) {
  const p = e.paragrafos.map((t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#33415c">${esc(t)}</p>`).join("");
  const botao = e.botao ? `<p style="margin:22px 0"><a href="${esc(e.botao.url)}" style="display:inline-block;background:#13294b;color:#ffffff;
    text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${esc(e.botao.texto)}</a></p>
    <p style="margin:0 0 14px;font-size:12px;color:#6b778c">Se o botão não abrir, copie este endereço no navegador:<br>${esc(e.botao.url)}</p>` : "";
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e1e6ef">
  <tr><td style="background:#13294b;border-radius:12px 12px 0 0;padding:18px 28px;font-size:20px;font-weight:700;color:#ffffff">
    Loti<span style="color:#f6d35b">Visse</span></td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 16px;font-size:20px;color:#13294b">${esc(e.titulo)}</h1>${p}${botao}
    <p style="margin:24px 0 0;font-size:12px;color:#6b778c">${esc(e.rodape ?? `E-mail automático da ${MARCA}. Não precisa responder.`)}</p>
  </td></tr></table></td></tr></table></body></html>`;
  const texto = [e.titulo, "", ...e.paragrafos, ...(e.botao ? ["", `${e.botao.texto}: ${e.botao.url}`] : [])].join("\n");
  return { html, texto };
}

/** Envia um e-mail. Devolve o motivo quando não envia (sem configuração ou recusado pela Brevo). */
export async function enviarEmail(e: Email): Promise<string | null> {
  if (!emailConfigurado()) return "envio de e-mail não configurado (BREVO_API_KEY e EMAIL_REMETENTE)";
  const de = remetente();
  if (!de) return `EMAIL_REMETENTE inválido na Vercel ("${process.env.EMAIL_REMETENTE}"): use só o endereço, por exemplo avisos@lotivisse.com.br`;
  const { html, texto } = montar(e);
  try {
    let corpo = "";
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY!.trim().replace(/^["']|["']$/g, ""), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: de, name: (process.env.EMAIL_REMETENTE_NOME ?? "").trim() || MARCA },
        to: [{ email: e.para.email, ...(e.para.nome ? { name: e.para.nome } : {}) }],
        subject: e.assunto, htmlContent: html, textContent: texto,
      }),
      cache: "no-store",
    });
    if (r.status === 401) return "a Brevo não reconheceu a BREVO_API_KEY (use a chave de API, que começa com xkeysib-, não a chave SMTP)";
    if (r.status === 400 && /sender/i.test(corpo = await r.text())) {
      return `a Brevo não aceitou o remetente ${de}: cadastre e confirme esse endereço em Remetentes na Brevo (ou autentique o domínio)`;
    }
    if (!r.ok) return `Brevo recusou (${r.status}): ${(corpo || await r.text()).slice(0, 200)}`;
    return null;
  } catch (erro) {
    return `sem contato com a Brevo: ${(erro as Error).message}`;
  }
}

/** Endereço do portal (para os links dos e-mails). */
export async function enderecoSite() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/**
 * Link de uso único para a pessoa criar a senha (conta nova ou "esqueci minha senha"). Abre em qualquer
 * navegador: vai para /auth/confirmar com o token, que abre a sessão e leva para "Crie uma senha nova".
 */
export async function linkCriarSenha(email: string): Promise<string | null> {
  const { data, error } = await clienteAdmin().auth.admin.generateLink({ type: "recovery", email });
  const token = data?.properties?.hashed_token;
  if (error || !token) return null;
  return `${await enderecoSite()}/auth/confirmar?token_hash=${encodeURIComponent(token)}&type=recovery&proximo=/redefinir-senha`;
}

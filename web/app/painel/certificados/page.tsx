import { contexto } from "@/lib/sessao";
import { dataBR, formatarDocumento } from "@/lib/documentos";
import { nomeTipo } from "@/lib/xml";
import BotaoRemover from "../empresas/BotaoRemover";
import { removerCertificado } from "../actions-nfse";
import FormCertificado from "./FormCertificado";

type Certificado = { id: string; cnpj: string; nome: string; validade: string | null; atualizado_em: string; organizacoes?: { nome: string } | null };
type EmpresaNfse = { id: string; org_id: string; cnpj: string; codigo: string; nome: string; tipos: string[]; organizacoes?: { nome: string } | null };

const DIA = 86_400_000;

function situacao(validade: string | null): { nome: string; classe: string } {
  if (!validade) return { nome: "Validade não lida", classe: "st-neutro" };
  const dias = Math.floor((Date.parse(validade) - Date.now()) / DIA);
  if (dias < 0) return { nome: "Vencido", classe: "st-erro" };
  if (dias <= 30) return { nome: `Vence em ${dias} dia${dias === 1 ? "" : "s"}`, classe: "st-alerta" };
  return { nome: "Válido", classe: "st-ok" };
}

export default async function Certificados() {
  const { supabase, admin } = await contexto();
  // o certificado e a senha cifrados não podem ser lidos pelo usuário: só as colunas abaixo
  const [{ data: c }, { data: e }, organizacoes] = await Promise.all([
    supabase.from("xml_nfse_certificados").select("id, org_id, cnpj, nome, validade, atualizado_em, organizacoes(nome)").order("nome"),
    supabase.from("xml_nfse_empresas").select("id, org_id, cnpj, codigo, nome, tipos, organizacoes(nome)").order("nome"),
    admin ? supabase.from("organizacoes").select("id, nome").eq("ativo", true).order("nome").then((r) => r.data ?? []) : undefined,
  ]);
  const certificados = (c ?? []) as unknown as (Certificado & { org_id: string })[];
  const empresas = (e ?? []) as unknown as EmpresaNfse[];
  const certificadoDe = (x: EmpresaNfse) => {
    const daRaiz = certificados.filter((k) => k.org_id === x.org_id && k.cnpj.slice(0, 8) === x.cnpj.slice(0, 8));
    return daRaiz.find((k) => k.cnpj === x.cnpj) ?? daRaiz.find((k) => k.cnpj.slice(8, 12) === "0001") ?? daRaiz[0];
  };

  return (
    <>
      <h1>Certificados A1 da NFS-e</h1>
      <div className="cartao">
        <h2 className="titulo-cartao">Enviar um certificado</h2>
        <p className="suave">
          O robô baixa as NFS-e pela API oficial do Portal Nacional usando o certificado digital A1 (e-CNPJ) da empresa.
          O certificado da matriz também serve às filiais. O arquivo e a senha ficam cifrados: nem o portal consegue abri-los,
          só o robô. Enviar de novo o certificado do mesmo CNPJ substitui o anterior (por exemplo, na renovação).
        </p>
        <FormCertificado organizacoes={organizacoes} />
      </div>

      <div className="cartao">
        <h2 className="titulo-cartao">Certificados guardados</h2>
        {!certificados.length ? (
          <p className="suave">Nenhum certificado enviado ainda.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>{admin && <th>Organização</th>}<th>Titular</th><th>CNPJ</th><th>Validade</th><th>Situação</th><th>Enviado em</th><th></th></tr>
              </thead>
              <tbody>
                {certificados.map((x) => {
                  const s = situacao(x.validade);
                  return (
                    <tr key={x.id}>
                      {admin && <td>{x.organizacoes?.nome}</td>}
                      <td>{x.nome || <span className="suave">sem nome</span>}</td>
                      <td>{formatarDocumento(x.cnpj)}</td>
                      <td>{x.validade ? dataBR(x.validade.slice(0, 10)) : "—"}</td>
                      <td><span className={`status ${s.classe}`}>{s.nome}</span></td>
                      <td>{dataBR(x.atualizado_em.slice(0, 10))}</td>
                      <td>
                        <form action={removerCertificado}>
                          <input type="hidden" name="id" value={x.id} />
                          <BotaoRemover apelido={`o certificado de ${x.nome || formatarDocumento(x.cnpj)}`} />
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cartao">
        <h2 className="titulo-cartao">Empresas da NFS-e</h2>
        <p className="suave">Entram pela planilha da NFS-e no Agendar. Aqui aparece qual certificado o robô vai usar para cada uma.</p>
        {!empresas.length ? (
          <p className="suave">Nenhuma empresa da NFS-e ainda.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>{admin && <th>Organização</th>}<th>ID</th><th>Empresa</th><th>CNPJ</th><th>Certificado</th><th>Serviços</th></tr>
              </thead>
              <tbody>
                {empresas.map((x) => {
                  const cert = certificadoDe(x);
                  const s = cert ? situacao(cert.validade) : null;
                  return (
                    <tr key={x.id}>
                      {admin && <td>{x.organizacoes?.nome}</td>}
                      <td>{x.codigo}</td>
                      <td>{x.nome}</td>
                      <td>{formatarDocumento(x.cnpj)}</td>
                      <td>
                        {!cert ? <span className="status st-erro">Falta o certificado</span> : (
                          <span className={`status ${s!.classe}`}>
                            {cert.cnpj === x.cnpj ? "Próprio" : `Da matriz ${formatarDocumento(cert.cnpj)}`}
                            {s!.classe !== "st-ok" && ` · ${s!.nome.toLowerCase()}`}
                          </span>
                        )}
                      </td>
                      <td>{x.tipos.map(nomeTipo).join(", ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

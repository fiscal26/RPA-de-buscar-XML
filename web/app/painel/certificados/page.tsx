import Link from "next/link";
import { contexto } from "@/lib/sessao";
import { dataBR, formatarDocumento } from "@/lib/documentos";
import { situacaoValidade } from "@/lib/nfse";
import BotaoRemover from "../empresas/BotaoRemover";
import { removerCertificado } from "../actions-nfse";
import FormCertificado from "./FormCertificado";

type Certificado = { id: string; cnpj: string; nome: string; validade: string | null; atualizado_em: string; organizacoes?: { nome: string } | null };

export default async function Certificados() {
  const { supabase, admin } = await contexto();
  // o certificado e a senha cifrados não podem ser lidos pelo usuário: só as colunas abaixo
  const [{ data: c }, organizacoes] = await Promise.all([
    supabase.from("xml_nfse_certificados").select("id, cnpj, nome, validade, atualizado_em, organizacoes(nome)").order("nome"),
    admin ? supabase.from("organizacoes").select("id, nome").eq("ativo", true).order("nome").then((r) => r.data ?? []) : undefined,
  ]);
  const certificados = (c ?? []) as unknown as Certificado[];

  return (
    <>
      <h1>Certificados A1</h1>
      <p className="suave introducao">
        O robô baixa as NFS-e pela API oficial do Portal Nacional usando o certificado digital A1 (e-CNPJ) da empresa. O
        certificado da matriz também serve às filiais. Qual certificado cada empresa usa aparece em <Link href="/painel/empresas">Empresas</Link>.
      </p>

      <section className="cartao">
        <h2 className="titulo-cartao">Enviar um certificado</h2>
        <p className="suave">
          O arquivo e a senha ficam cifrados: nem o portal consegue abri-los, só o robô. Enviar de novo o certificado do mesmo
          CNPJ substitui o anterior (por exemplo, na renovação).
        </p>
        <FormCertificado organizacoes={organizacoes} />
      </section>

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">Certificados guardados</h2>
          <span className="suave">{certificados.length} {certificados.length === 1 ? "certificado" : "certificados"}</span>
        </div>
        {!certificados.length ? (
          <p className="suave">Nenhum certificado enviado ainda. Envie o primeiro no formulário acima.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>{admin && <th>Organização</th>}<th>Titular</th><th>CNPJ</th><th>Validade</th><th>Situação</th><th>Enviado em</th><th></th></tr>
              </thead>
              <tbody>
                {certificados.map((x) => {
                  const s = situacaoValidade(x.validade);
                  return (
                    <tr key={x.id}>
                      {admin && <td>{x.organizacoes?.nome}</td>}
                      <td>{x.nome || <span className="suave">sem nome</span>}</td>
                      <td className="doc">{formatarDocumento(x.cnpj)}</td>
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
      </section>
    </>
  );
}

import Link from "next/link";
import Icone from "@/components/Icones";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR } from "@/lib/documentos";
import { EM_ANDAMENTO } from "@/lib/xml";

const ROBO_ONLINE_SEGUNDOS = 120;

export default async function Inicio() {
  const { supabase, perfil, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const [{ data: ultimo }, { count: empresas }, { data: robos }, { count: pessoas }] = await Promise.all([
    supabase.from("xml_agendamentos").select("id, competencia, criado_em").order("criado_em", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("xml_empresas").select("id", { count: "exact", head: true }),
    supabase.from("xml_robos").select("id, ultimo_sinal").order("ultimo_sinal", { ascending: false }).limit(1),
    supabase.from("perfis").select("id", { count: "exact", head: true }),
  ]);
  let tarefas: { status: string }[] = [];
  if (ultimo) {
    const { data } = await supabase.from("xml_tarefas").select("status").eq("agendamento_id", ultimo.id).limit(5000);
    tarefas = data ?? [];
  }
  const robo = robos?.[0];
  const roboLigado = !!robo && Date.now() - Date.parse(robo.ultimo_sinal) < ROBO_ONLINE_SEGUNDOS * 1000;
  const fila = tarefas.filter((t) => EM_ANDAMENTO.includes(t.status)).length;
  const prontas = tarefas.filter((t) => t.status === "concluido" || t.status === "sem_notas").length;
  const atencao = tarefas.length - fila - prontas - tarefas.filter((t) => t.status === "cancelado").length;

  const passos = [
    { feito: !!empresas, titulo: "Preencher a planilha modelo",
      texto: "Inscrição estadual, nome e o login do contador no ATF de cada empresa.", href: "/painel/agendar" },
    { feito: !!robo, titulo: "Ligar o robô no computador do escritório",
      texto: "Ele roda junto do Chrome e busca os agendamentos sozinho.", href: "/painel/agendamentos" },
    { feito: !!ultimo, titulo: "Agendar a primeira competência",
      texto: "Envie a planilha e escolha o mês e a hora.", href: "/painel/agendar" },
    ...(gerencia ? [{ feito: (pessoas ?? 0) > 1, titulo: "Cadastrar a equipe",
      texto: "Cada pessoa do escritório com o próprio acesso.", href: "/painel/equipe" }] : []),
  ];
  const pendentes = passos.filter((p) => !p.feito).length;

  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Bem-vindo, {(perfil.nome || perfil.email).split(" ")[0]}</h1>
          <p className="suave">O andamento do escritório no ATF da SEFAZ-PB.</p>
        </div>
        <Link href="/painel/agendar" className="botao">Agendar competência</Link>
      </div>

      {pendentes > 0 && (
        <section className="cartao">
          <h2 className="titulo-cartao">Primeiros passos</h2>
          <p className="suave">Falta{pendentes > 1 ? "m" : ""} {pendentes} de {passos.length} para o escritório ficar pronto.</p>
          <ul className="passos-lista">
            {passos.map((p) => (
              <li key={p.titulo}>
                <Link href={p.href}>
                  <span className="passo-texto"><b>{p.titulo}</b><span>{p.texto}</span></span>
                  <span className={`passo-situacao ${p.feito ? "feito" : ""}`}>{p.feito ? "Concluído" : "Pendente"}</span>
                  <Icone nome="seta" tamanho={18} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="indicadores">
        <Link href="/painel/agendamentos" className="indicador">
          <span className="nome">Robô</span>
          <span className={`valor ${roboLigado ? "ok" : ""}`}>{roboLigado ? "Ligado" : "Desligado"}</span>
          <span className="suave">{robo ? `Último sinal em ${dataHoraBR(robo.ultimo_sinal)}` : "Ainda não se conectou"}</span>
        </Link>
        <Link href={ultimo ? `/painel/agendamentos/${ultimo.id}` : "/painel/agendar"} className="indicador">
          <span className="nome">Último agendamento</span>
          <span className="valor">{ultimo ? competenciaBR(ultimo.competencia) : "Nenhum"}</span>
          <span className="suave">
            {ultimo ? `${prontas} pronta(s), ${fila} na fila${atencao > 0 ? `, ${atencao} com erro` : ""}` : "Agende a primeira competência"}
          </span>
        </Link>
        <Link href="/painel/empresas" className="indicador">
          <span className="nome">Empresas</span>
          <span className="valor">{empresas ?? 0}</span>
          <span className="suave">cadastradas pelas planilhas</span>
        </Link>
      </div>
    </>
  );
}

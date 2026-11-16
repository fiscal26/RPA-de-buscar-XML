# Revisão do plano — Codex 2

Status: preparada; usuário indicará a sessão revisora. Nenhum parecer emitido.

- Repositório: `C:/Users/joao.henrique/worktrees/rpa-integracao-plano`.
- Branch: `integracao/plano-isolamento-escritorios`.
- Base: `5256b9bee959d61cdaea81b18a32dd2dbe00e78d`.
- Entrega: [plano de integração](../planos/integracao-isolamento-escritorios.md).
- Referência: `correcao/motor-por-contexto`, commit `5f76f92`, em `C:/Dev/RPA-de-buscar-XML`; preservar suas alterações locais.

Revise a decisão antes de qualquer mudança nas pastas operacionais. Compare a entrega com a main indicada e com as garantias da referência. Não implemente nem ative serviços, coleta fiscal ou migrações.

Confira:

1. Identidade por escritório/origem/documento, filial/procurador, modo local, nomes iguais, renomeação, cache e gravação recuperável.
2. Novidades da main: PDFs, XML mensal ABRASF, procuração, lacunas MEI apuradas no banco, MEI pausado, períodos, reprocessamento SEFAZ, descoberta MEI e Monitor Fiscal.
3. Competências existentes acessíveis/reprocessadas no caminho original; competências novas em MMAAAA; conflito explícito quando AAAA-MM e MMAAAA coexistem para a mesma identidade/mês, sem escolher, gravar, publicar ou importar ambos automaticamente. Incluir pasta vazia, conteúdo igual e identidades diferentes. Conferir os caminhos existentes na integração Domínio, além da nova raiz, e o isolamento, compartilhamentos e exclusão de arquivos internos no Drive. Confronte com `servidor/drive.sh`.
4. Diferenças entre APIs paralelas, caixa atrasada ATF e manifestação/retomada Monitor. A matriz deve cobrir tarefa, arquivos, retorno ao banco e painel, incluindo interrupção e dois consumidores independentes.
5. Separação entre integração, publicação, ativação e retirada SQL condicionada à atualização dos consumidores.

Relate achados por gravidade com arquivo/linha, cenário, consequência e evidência. Diferencie defeitos, decisões pendentes e ensaios de homologação. Explique termos essenciais em português simples. Termine com parecer sobre o plano e condições para iniciar NFS-e. Separe inspeção de execução comprovada.

Verificação do autor: leitura dos fluxos atuais NFS-e/Monitor, testes, caminhos, script Drive, implantação e referência de isolamento. Somente dois documentos novos; sem resultado funcional novo a declarar.

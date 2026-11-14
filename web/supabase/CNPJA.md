# CNPJá pública no cadastro MEI

Integração exclusiva com `GET https://open.cnpja.com/office/{cnpj}`. Não usa API comercial, chave, assinatura ou consulta paga.

## Uso

Em **Empresas → Cadastro de MEI**, escolha a empresa e clique em **Consultar dados do CNPJ**. O retorno mostra razão social, nome fantasia, abertura, situação cadastral, indicador/data de inclusão no MEI e datas de consulta/atualização.

**Preencher campos vazios** sugere apenas abertura e início MEI informados pela fonte. Nunca copia abertura para início MEI, não altera datas preenchidas nem marca/desmarca o acompanhamento. Confira e use **Salvar cadastro MEI** para confirmar. Campo ausente aparece como não informado; Simples Nacional não é usado como indicador de MEI. O nome confirmado no sistema não é sobrescrito.

Uma divergência exibe aviso. A API pública pode ter defasagem; dados externos não removem empresas do monitoramento nem modificam períodos já cadastrados. A consulta não substitui a conferência do escritório.

## Banco e implantação

Aplicar a migração gerada pela CLI `migrations/20261113015516_cnpja_publica_cache_limite.sql` antes de publicar a branch aprovada. O `schema.sql` completo também inclui a estrutura. Não há alteração no robô nem variável de ambiente nova.

O cache guarda somente os campos utilizados, compartilhados por CNPJ no backend, por sete dias. O botão de atualização permite nova consulta após cinco minutos. Contatos e quadro societário não são armazenados. Tabelas e funções de cache são acessíveis apenas ao backend (`service_role`), com RLS habilitado e sem acesso direto de `anon`/`authenticated`. A ação exige gestor/admin e confirma que o CNPJ pertence a uma empresa visível na sessão antes de usar o cache.

Todas as instâncias do portal compartilham um controle no PostgreSQL. Há espaçamento mínimo de 13 segundos entre reservas externas, garantindo no máximo cinco admissões por minuto no aplicativo. Cliques concorrentes para o mesmo CNPJ reaproveitam a consulta salva ou recebem uma espera. Reservas expiram em 25 segundos; requisições têm timeout de oito segundos. Não há fila automática de varredura da carteira nesta versão: o usuário consulta as empresas pelo botão.

O limite da CNPJá é por IP, e a hospedagem pode compartilhar IP com outros aplicativos. Respostas 429 geram espera global, respeitando `Retry-After`, limitada a uma hora. Não há repetição automática de chamadas. Erros, 404 e timeout não são convertidos em “não MEI”. O último resultado válido é preservado e, quando exibido após falha, aparece com aviso de possível desatualização. Retornos de uma reserva antiga não sobrescrevem a atual.

## Testes

```text
npm run typecheck
npm run test:cnpja
npm run test:mei
npm run test:mei:db
npm run build
```

Os testes não consultam clientes reais. Cobrem normalização, indicador ausente, datas distintas, respostas inválidas, timeout/rede, 404, 429, reaproveitamento, autorização, permissões SQL e reservas concorrentes/expiradas.

Referência oficial: https://cnpja.com/api/open

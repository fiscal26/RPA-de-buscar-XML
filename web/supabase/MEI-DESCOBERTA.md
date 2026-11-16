# Cadastro e acompanhamento MEI

O botão **Trazer MEIs cadastrados**, em Monitoramento MEI, verifica os CNPJs já cadastrados na SEFAZ e na NFS-e do escritório, sem duplicação. Uma confirmação inclui os elegíveis selecionados. Desmarcar apenas adia a inclusão; **Ignorar este CNPJ** registra uma exclusão persistente. Pausar/ignorar não exige datas, não apaga documentos ou valores e não é desfeito por importação ou indicação em XML.

Depois da ativação, CNPJs realmente novos são verificados e incluídos automaticamente se a base confirmar SIMEI e datas válidas. A carteira antiga não é incluída ao aplicar a migração. A ausência de Dossiê MEI no legado não comprova exclusão: o lote exige confirmação explícita. O banco conserva datas manuais, abertura e início no SIMEI separados, período, decisões e auditoria. Retorno atual “não MEI” em empresa acompanhada gera revisão, preservando histórico e sem deduzir desenquadramento. Uma empresa com fim de período continua acessível nos anos abrangidos.

## Ativação no Supabase (necessária)

No SQL Editor do **projeto do portal XML**, execute o arquivo completo:

`web/supabase/migrations/20261116021315_mei_descoberta_acompanhamento.sql`

O schema anterior precisa estar atualizado com as migrações existentes do projeto. Para instalações que acompanham apenas o arquivo consolidado, pode executar **o `web/supabase/schema.sql` completo e atualizado** em vez da migração isolada. Ambos contêm a mesma atualização, são reaplicáveis e preservam os dados existentes. Não execute somente fragmentos. Não precisa apagar ou recriar tabelas.

Validação (SQL Editor, apenas leitura):

```sql
select estado, count(*) from public.xml_mei_acompanhamento group by estado;
select origem, estado, count(*) from public.xml_mei_sincronizacoes group by origem, estado;
select ultimo_sinal from public.xml_mei_worker;
```

Até a atualização, o gerenciamento avisa que o banco precisa ser atualizado; o cadastro individual e o monitoramento anterior continuam disponíveis. A publicação do código não aplica SQL automaticamente.

## Ativação na VPS (necessária para processar a fila)

Depois do merge, da publicação em produção e da atualização do Supabase:

```bash
sudo lotivisse atualizar xml
sudo bash /home/lotivisse/xml/app/servidor/instalar_mei.sh
```

O instalador cria `lotivisse-mei-cadastros.service`, independente do Chrome e das filas fiscais. Usa somente a biblioteca padrão do Python e o `robo/config.json` existente. Não precisa de chave nova ou variável nova na Vercel. `portal.site`, se configurado, deve ser a origem HTTPS do portal; o padrão é `https://xml.lotivisse.com.br`.

A credencial enviada à rota é um HMAC com escopo próprio derivado da chave administrativa existente. A chave administrativa não é transmitida nessa chamada. **A chave no config.json precisa corresponder à `SUPABASE_SERVICE_ROLE_KEY` do ambiente de produção.** Se forem chaves diferentes do mesmo projeto (ex.: JWT antigo na VPS e Secret key na Vercel), alinhe os valores de maneira privada; nunca cole chaves no terminal/chat. A troca da chave exige reiniciar o serviço, que a lê ao iniciar.

Verificação/diagnóstico:

```bash
sudo systemctl status lotivisse-mei-cadastros --no-pager
sudo journalctl -u lotivisse-mei-cadastros -n 30 --no-pager
```

A tela mostra o último sinal do serviço. Com o serviço parado, os pedidos permanecem no banco. Para pausar o processamento sem perder a fila: `sudo systemctl stop lotivisse-mei-cadastros`.

## Processamento e limites

- Cada chamada protegida processa um item; reserva de 45 segundos com token, retomada após expiração, SKIP LOCKED e versão da decisão. Uma decisão manual durante a consulta prevalece.
- CNPJá usa o cache existente de sete dias e o intervalo global de 13 segundos, compartilhado com consultas individuais. O serviço chama a rota a cada 15 segundos. Erros transitórios têm até cinco tentativas com espera crescente; limite de quota apenas adia, sem consumir tentativa. Falha final aparece para revisão; iniciar novo lote permite tentar novamente.
- Sem trabalho, o serviço prepara até vinte revisões de acompanhamentos ativos sem verificação nos últimos sete dias. Revisão periódica não muda datas confirmadas nem inclui carteira antiga.
- Resultados, itens, histórico e acompanhamento têm RLS por escritório; navegador só lê. Escrita administrativa ocorre no servidor com validação de perfil/organização. RPC de faturamento usa a sessão e as permissões fiscais existentes, com falhas isoladas por empresa. Pausas são respeitadas também na preparação de tarefas que aguardavam na fila; consultas já em execução podem concluir e seu histórico permanece guardado.
- Identificação cadastral **não traz faturamento**. Valores já importados são reaproveitados. “Sem consulta” permanece distinto de zero. A ação separada de atualizar faturamento usa os acessos ATF/certificados e a fila fiscal existentes.

## Testes locais sem dados de clientes

```bash
cd web
npm run typecheck
npm run test:mei:descoberta
node --test tests/*.test.cjs
npm run test:interface
npm run build
cd ..
python3 -m unittest discover -s servidor/tests -v
bash -n servidor/instalar_mei.sh
```

Os testes de banco usam PostgreSQL local em PGlite, com RLS, perfis fictícios, aplicação/reaplicação da migração e RPCs reais. O teste de interface sobe uma cópia temporária com sessão e backend fictícios, sem credenciais nem gravação em serviços externos. O serviço VPS é validado por mocks de HTTP; não foi instalado na VPS por estes testes.

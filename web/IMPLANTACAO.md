# Implantação do LotiVisse XML

Três partes: o **banco** (Supabase), o **portal** (Vercel, em `xml.lotivisse.com.br`) e o **robô** (seu PC).

Na Vercel, o projeto precisa de **Root Directory = `web`** e **Framework Preset = Next.js** (o `web/vercel.json`
já fixa o Next.js), sem Build/Output/Install Command sobrescritos. Com a raiz errada a Vercel responde 404;
com o preset errado, erro 500 "Cannot use import statement outside a module" no `middleware.js`.

No portal, a página inicial (`/`) é a apresentação, aberta a todos; o login fica em `/login` e o painel
(agendar, agendamentos, empresas) em `/painel`, só para quem entrou.

## 1. Banco (Supabase)

Projeto **próprio** do Supabase (separado do portal de CND; só o domínio e a marca são os mesmos).

1. Crie o projeto no Supabase (região São Paulo).
2. **SQL Editor** > cole todo o `web/supabase/schema.sql` > **Run**. Pode rodar de novo sem perder dados.
3. **Só o seu acesso de administrador** é criado aqui: em **Authentication > Users > Add user** (marque
   *Auto Confirm User*) e depois, no **SQL Editor**:
   ```sql
   insert into public.perfis (id, nome, email, papel, ativo)
   select id, 'Seu nome', email, 'admin', true from auth.users where email = 'seu-email@exemplo.com'
   on conflict (id) do update set papel = 'admin', ativo = true, org_id = null;
   ```
   Os escritórios clientes e as pessoas são criados no próprio portal, em **Painel > Equipe**: o admin cria o
   escritório com o gestor; o gestor cadastra os colaboradores do escritório. (Precisa da variável
   `SUPABASE_SERVICE_ROLE_KEY` na Vercel.)
4. Anote em **Project Settings > API**: a URL, a chave `anon`/`publishable` e a `service_role`/`secret`.

## 2. Chaves das senhas (no PC do robô)

```bash
cd robo
pip install -r requirements.txt
gerar_chaves.bat
```

Ele cria `robo/chaves/robo_privada.pem` e mostra uma linha longa: é a **chave pública**.
Guarde uma cópia da chave privada em local seguro (pendrive/cofre). Se perder, as senhas
precisam ser enviadas de novo. Para ver a pública de novo: `python robo_xml.py --mostrar-chave-publica`.

## 3. Portal (Vercel)

1. Vercel > **Add New Project** > importe este repositório > **Root Directory: `web`**.
2. **Environment Variables** (as mesmas do `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (nunca com o prefixo `NEXT_PUBLIC_`)
   - `XML_CHAVE_PUBLICA`: a linha mostrada pelo `gerar_chaves.bat`
3. **Deploy**.
4. **Domínio**: Vercel > Settings > Domains > `xml.lotivisse.com.br`. No painel do domínio
   lotivisse.com.br, crie o registro **CNAME** `xml` apontando para `cname.vercel-dns.com`
   (a Vercel mostra o valor exato).
5. Supabase > Authentication > URL Configuration: em *Site URL* coloque `https://xml.lotivisse.com.br` e em
   *Redirect URLs* acrescente `https://xml.lotivisse.com.br/auth/confirmar` (o link do "Esqueci minha senha"
   volta por aí). Se o site tiver outro endereço, pode fixá-lo na variável `NEXT_PUBLIC_SITE_URL`.
   O e-mail de redefinição usa o envio do próprio Supabase (poucos por hora); para volume maior, configure
   um SMTP em Authentication > Emails.

## 4. Robô (seu PC)

1. Copie `robo/config.exemplo.json` para `robo/config.json` e preencha:
   - a pasta dos arquivos não precisa ser preenchida: o robô usa **Documentos\RPA XML LotiVisse deste
     computador** (com OneDrive, a pasta Documentos dele). Para outro lugar, acrescente
     `"pastas": {"destino": "D:\\Clientes\\XML"}`; se a pasta não existir ou não aceitar gravação, o robô
     avisa ao ligar e volta para a pasta Documentos;
   - `portal.supabase_url` e `portal.chave_service_role`;
   - `portal.nome_robo`: um nome para este PC (aparece no portal).
2. Abra o Chrome pelo `abrir_chrome.bat` (porta 9222, perfil próprio).
3. Ligue o robô com o `iniciar_robo.bat` e deixe a janela aberta. No portal, em **Agendamentos**,
   aparece "Robô ligado".

## 5. Primeiro teste (validação no ATF real)

1. Preencha a planilha modelo com uma ou duas empresas suas.
2. Rode sem o portal: `python robo_xml.py --local empresas.xlsx --competencia 09/2026` e acompanhe no Chrome.
3. Se alguma etapa não for reconhecida (login ou lista de notas depois do *Pesquisar*), o robô espera
   você concluir no Chrome (modo assistido) e salva um pacote em `<destino>/_diagnostico/`.
   Com esse pacote ajustamos o roteiro, e a partir daí fica automático.

## 6. Monitoramento de Faturamento MEI

1. **Atualize o banco:** no **SQL Editor**, rode de novo todo o `web/supabase/schema.sql` (cria as tabelas
   `xml_mei_meses` e `xml_mei_ajustes`, as funções `xml_mei_registrar`/`xml_mei_registrar_ie` e a coluna
   `nome_fixo` das empresas; não apaga nada).
2. **Atualize o robô** no PC (copie a pasta `robo/` nova) e ligue-o de novo. Ao ligar, ele manda ao painel o
   faturamento MEI que já está salvo no PC (`Arquivos baixados/<empresa>/Dossiê MEI/*.json`); depois, a cada
   Dossiê MEI, manda o ano inteiro da empresa. Para só enviar o histórico, sem processar a fila:
   `python robo_xml.py --enviar-mei`. No log aparece "Monitoramento MEI: N de M empresa(s) enviadas ao painel".
3. Enquanto o banco ou o robô não forem atualizados, o painel usa o resumo do mês guardado em cada execução do
   Dossiê MEI (sem o detalhe por documento).
4. No portal, **Monitoramento MEI** lista todos os MEIs do maior para o menor faturamento no ano (barras na
   mesma escala, com as linhas de 80%, do limite e de +20%); ao clicar, o painel do MEI mostra o uso dos
   limites de faturamento e de compras, o gráfico mês a mês/acumulado e os **lançamentos manuais**.

## 7. Nomes das empresas

Os nomes da planilha são corrigidos ao entrar ("lidi@ne silv4" vira "Lidiane Silva"; LTDA, ME, EPP e MEI ficam
em maiúsculas). Em **Empresas**, o botão **Renomear** troca o nome; o nome renomeado não muda mais com a
planilha. A pasta no PC do robô segue o nome: depois de renomear, os arquivos novos vão para a pasta com o
nome novo.

## 8. E-mails pela Brevo (acesso e alertas de MEI)

O portal manda três e-mails, todos pela API da Brevo: **conta criada** (link para a pessoa criar a própria senha),
**esqueci minha senha** e **alerta de limite do MEI** (para todas as pessoas do escritório; cada uma pode desligar
em Meu perfil). Os documentos não vão por e-mail: chegam ao cliente pela pasta sincronizada no Drive.

1. **Domínio na Brevo:** em *Senders, Domains & Dedicated IPs > Domains*, adicione `lotivisse.com.br` e crie no
   DNS do domínio os registros que a Brevo mostrar (código da Brevo, DKIM e DMARC). Espere ficar *Authenticated*;
   sem isso os e-mails caem no spam.
2. **Remetente:** em *Senders*, cadastre por exemplo `avisos@lotivisse.com.br` com o nome LotiVisse.
3. **Chave:** em *SMTP & API > API Keys*, gere uma chave. Ela vai só na Vercel (não mande por chat nem e-mail).
4. **Vercel > Settings > Environment Variables** (depois, faça um *Redeploy*):
   - `BREVO_API_KEY` = a chave do passo 3;
   - `EMAIL_REMETENTE` = `avisos@lotivisse.com.br`; `EMAIL_REMETENTE_NOME` = `LotiVisse` (opcional);
   - `CRON_SECRET` = uma senha longa qualquer (protege o alerta diário);
   - `NEXT_PUBLIC_SITE_URL` = `https://xml.lotivisse.com.br` (endereço dos links dos e-mails).
5. **Supabase:** rode de novo o `schema.sql` (tabela `xml_mei_alertas` e a opção `alertas_mei` das pessoas). Em
   *Authentication > Providers > Email*, aumente *Email OTP Expiration* para `86400` (o link de criar senha vale 24 h).
6. **Teste:**
   - em Equipe, crie um colaborador **sem** senha provisória: chega o e-mail "Seu acesso à LotiVisse";
   - no login, use "Esqueci minha senha": chega o e-mail "Crie sua senha nova" (o link abre em qualquer navegador);
   - alerta de MEI: roda todo dia às 8h (Brasília) pelo *Cron Job* da Vercel e logo depois de cada lançamento
     manual. Para rodar na hora: `curl -H "Authorization: Bearer SEU_CRON_SECRET" https://xml.lotivisse.com.br/api/cron/alertas-mei`.
     Na primeira vez, saem os alertas de todos os MEIs que já estão perto ou acima do limite.

**Login e porta (SMTP) não são usados pelo portal**: ele fala com a Brevo pela API, só com a chave. O SMTP é
opcional, para os e-mails que o próprio Supabase manda (o "esqueci minha senha" quando a Brevo não está na
Vercel): em *Supabase > Authentication > Emails > SMTP Settings*, ative o SMTP próprio com host
`smtp-relay.brevo.com`, porta `587`, usuário = o login SMTP da Brevo (*SMTP & API > aba SMTP*, algo como
`xxxx@smtp-brevo.com`), senha = uma **chave SMTP** gerada nessa mesma aba (é diferente da chave de API) e o mesmo
remetente `avisos@lotivisse.com.br`.

Sem a Brevo configurada, o portal continua funcionando: "Esqueci minha senha" usa o e-mail padrão do Supabase e
a criação de acesso exige a senha provisória.

## 9. Segurança (conferir uma vez)

1. **Supabase > Authentication > Sign In / Providers > Email:** desligue **"Allow new users to sign up"**. As contas
   são criadas só pela tela Equipe; com o cadastro aberto, qualquer pessoa conseguiria criar um login (não veria
   nenhum dado, mas ocuparia a base). Em *Password*, deixe o mínimo de 8 caracteres.
2. **Rode de novo o `schema.sql`:** ele traz as regras novas (escritório suspenso não enxerga nada nem pela API, o
   estado do robô só para o administrador, freio de tentativas de login e de "esqueci minha senha", índices).
3. **Chaves:** `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY` e `CRON_SECRET` ficam só na Vercel; nunca em código,
   chat ou e-mail. Se alguma vazar, gere outra e troque na Vercel.
4. **PC do robô:** o `config.json` tem a chave `service_role` e a chave privada das senhas do ATF. Use um usuário
   do Windows com senha, mantenha o disco cifrado (BitLocker) e guarde a cópia da chave privada fora do PC.

5. **Sessão:** o portal encerra a sessão após **15 minutos sem uso** (aviso 2 minutos antes; vale para todas as
   abas e para a aba esquecida aberta). No plano Pro do Supabase dá para reforçar no servidor, em *Authentication >
   Sessions* (*Inactivity timeout*), com um valor igual ou maior.

O que o portal já faz: cabeçalhos de segurança (não abre dentro de outro site, CSP, HSTS), páginas do painel sem
cache compartilhado, cada escritório só enxerga os próprios dados (regras no banco), 5 senhas erradas por e-mail
bloqueiam o login por 15 minutos, no máximo 2 links de senha nova por e-mail a cada 15 minutos, o agendamento
diário dos alertas exige o `CRON_SECRET` e os links dos e-mails só levam para páginas do próprio site.

## 10. Google (busca)

O site já publica `https://xml.lotivisse.com.br/robots.txt` e `/sitemap.xml`, título e descrição, imagem de
compartilhamento e os dados estruturados (o que é o site). A área logada e as telas de senha ficam fora da busca.

1. Entre em **search.google.com/search-console** > *Adicionar propriedade* > **Prefixo do URL** >
   `https://xml.lotivisse.com.br`.
2. Verifique pela **Tag HTML**: copie só o código do `content="..."` e crie na Vercel a variável
   `GOOGLE_SITE_VERIFICATION` com esse código; faça o *Redeploy* e clique em *Verificar*.
   (Se o domínio estiver no Search Console como *Domínio*, a verificação por DNS também serve.)
3. Em **Sitemaps**, envie `sitemap.xml`. Em **Inspeção de URL**, cole o endereço da página inicial e clique em
   *Solicitar indexação*. O Google costuma levar de alguns dias a algumas semanas para mostrar o site.
4. Ajuda muito ter links apontando para o site: no site principal da LotiVisse, no Instagram/LinkedIn e no
   perfil da empresa no Google (Google Meu Negócio).

## 11. NFS-e pelo Portal Nacional (certificado A1)

As notas de serviço vêm da **API oficial do Portal Nacional da NFS-e** (ADN, `adn.nfse.gov.br`), gratuita, em lote
e sem captcha. O acesso é o **certificado digital A1 (e-CNPJ)** da empresa; o da matriz serve às filiais.

1. **Banco:** rode o `supabase/schema.sql` de novo no *SQL Editor* (cria os certificados, as empresas da NFS-e e a
   fila própria; não apaga nada).
2. **Portal:** nada novo na Vercel. O certificado e a senha são cifrados com a mesma `XML_CHAVE_PUBLICA` das senhas
   do ATF: só o robô, com a chave privada, abre.
3. **Robô:** `git pull` e `pip install -r requirements.txt`. O robô atende a fila da NFS-e antes da do ATF (não usa o Chrome).
4. **Uso:**
   1. Em **Certificados**, envie o .pfx e a senha de cada empresa. O portal confere a senha, lê o CNPJ e a validade e
      avisa quando faltar 30 dias para vencer.
   2. Em **Agendar > Portal Nacional (NFS-e)**, envie a planilha modelo da NFS-e (CNPJ, nome e os serviços).
   3. Cada empresa ganha, em `Arquivos baixados/<ID>-<Nome>/<AAAA-MM>/`, as pastas `NFS-e Emitidas` e
      `NFS-e Recebidas` (XML e PDF) e o `Retenções NFS-e AAAA-MM.xlsx`.
5. **Teste sem o portal:** `robo\testar_nfse.bat` (pede o .pfx e a senha na hora; nada fica gravado).

O robô guarda no PC uma cópia das notas já recebidas (`robo/nfse_cache`, fora do git): a próxima busca traz só o
que for novo. Endereços e regras da API: `robo/NFSE.md`.

### Páginas por assunto e Bing (Edge)

- Cada busca importante tem uma página própria: `/baixar-xml-nfe-sefaz`, `/baixar-nfse-em-lote`,
  `/relatorio-retencoes-nfse` e `/limite-faturamento-mei`. Os textos ficam em `lib/assuntos.ts`; para criar uma página
  nova, acrescente um item na lista (endereço, título, descrição, blocos e perguntas). Ela entra sozinha no sitemap,
  nos links do rodapé e da página inicial.
- **Edge/Bing:** em **bing.com/webmasters**, entre com a conta Google e escolha *Importar do Google Search Console*
  (traz o site e o sitemap). Vale para Bing, Edge, DuckDuckGo e Yahoo.
- Depois de publicar páginas novas, peça a indexação delas no Search Console e no Bing (*Inspeção de URL*).

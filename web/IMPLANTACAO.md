# Implantação do LotiVisse XML

Três partes: o **banco** (Supabase), o **portal** (Vercel, em `xml.lotivisse.com.br`) e o **robô** (seu PC).

## 1. Banco (Supabase)

Pode usar **o mesmo projeto do portal de CND** (recomendado: o cliente usa o mesmo login e as
organizações já existem) ou um projeto novo.

1. Supabase > **SQL Editor** > cole todo o `web/supabase/schema.sql` > **Run**. Pode rodar de novo
   sem perder dados.
2. Projeto novo: crie os usuários em **Authentication > Users** e, para cada um, uma linha em
   `organizacoes` e em `perfis` (papel `gestor` ou `usuario`; o seu, `admin`).
3. Anote em **Project Settings > API**: a URL, a chave `anon`/`publishable` e a `service_role`/`secret`.

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
5. Supabase > Authentication > URL Configuration: acrescente `https://xml.lotivisse.com.br` em
   *Redirect URLs*.

## 4. Robô (seu PC)

1. Copie `robo/config.exemplo.json` para `robo/config.json` e preencha:
   - `pastas.destino`: a pasta onde os XML devem ficar;
   - `portal.supabase_url` e `portal.chave_service_role`;
   - `portal.nome_robo`: um nome para este PC (aparece no portal).
2. Abra o Chrome pelo `abrir_chrome.bat` (porta 9222, perfil próprio).
3. Ligue o robô com o `iniciar_robo.bat` e deixe a janela aberta. No portal, em **Agendamentos**,
   aparece "Robô ligado".

## 5. Primeiro teste (calibração)

1. Teste local com uma empresa sua, sem o portal:
   `python robo_xml.py --local empresas.xlsx --inicio 01/09/2026 --fim 30/09/2026`
2. Se o robô entrar no ATF mas não reconhecer a tela de download, ele espera você baixar no Chrome
   (modo assistido) e salva um pacote em `<destino>/_diagnostico/`.
3. Com esse pacote (e o endereço da tela de download que você usou) preenchemos
   `atf.url_download` e, se precisar, `atf.seletores` no `config.json`. A partir daí, automático.

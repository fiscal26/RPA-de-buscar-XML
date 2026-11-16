# Cadastro individual de empresas

Em **Empresas → Cadastrar empresa**, escolha o escritório (administrador) e a origem:

- **NFS-e**: CNPJ, nome, código opcional e serviços. O certificado pode ser enviado depois, em Certificados. Para consultar, valem os certificados e procurações já aceitos pelo portal.
- **SEFAZ da Paraíba**: nome, IE válida, CNPJ/CPF opcional, códigos e serviços. Escolha explicitamente um login ATF do escritório ou cadastre um novo login e senha. O acesso existente conserva a senha. Novas senhas são cifradas com a chave pública do robô.

A consulta de CNPJ sugere o nome e mostra abertura/SIMEI, fonte e data. Usa o cache e a quota global existentes; se indisponível, o preenchimento manual continua disponível. O nome confirmado é preservado nas próximas planilhas. CNPJ/IE duplicados na mesma origem/escritório não são substituídos. O mesmo CNPJ nas duas origens continua agrupado na carteira.

Após salvar, **Agendar consultas desta empresa** abre o agendamento com a empresa e escritório selecionados. Na SEFAZ, agora também há a opção **Escolher entre as cadastradas**, com busca, seleção e conferência. A confirmação relê empresas, serviços e acessos; não recria empresas removidas durante a prévia nem recebe senha do navegador. A NFS-e mantém sua seleção e certificados existentes.

Salvar o cadastro não agenda consultas fiscais. Quando a rotina MEI já estiver ativada, a identificação de novos CNPJs segue a fila e as decisões persistentes já existentes, inclusive pausas e exclusões.

## Banco e instalação

Esta alteração usa somente as tabelas, índices, funções de agendamento e chaves existentes. **Não precisa de nova migração SQL ou atualização adicional da VPS.** As etapas de ativação da rotina MEI da mudança anterior continuam próprias daquela funcionalidade.

A permissão de cadastro segue a importação: usuários ativos podem cadastrar no seu escritório; administrador pode escolher um escritório ativo. A consulta e a gravação são conferidas no servidor. Nenhuma senha guardada ou chave administrativa é enviada ao cliente.

Se a criação de um login novo concluir e a gravação da empresa falhar, o portal informa que o acesso foi salvo. Ele fica disponível para seleção na nova tentativa; não é apagado, pois pode ter sido reutilizado por outro cadastro.

## Validação local

`npm run test:cadastro` verifica documentos, duplicidade, isolamento, cifragem, preservação dos acessos, integração com a fila MEI e agendamento SEFAZ com PostgreSQL local. `npm run test:interface` exercita cadastro NFS-e, sugestão CNPJá, cadastro SEFAZ no celular, recuperação após erro e agendamento sem planilha em uma cópia temporária com dados fictícios. `npm run typecheck` e `npm run build` verificam a aplicação.

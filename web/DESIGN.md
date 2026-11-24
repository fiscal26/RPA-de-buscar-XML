# Interface do LotiVisse

## Direção

O painel é uma central de operações contábeis. No modo escuro, a navegação e a barra superior usam grafite e as divisões estruturam o conteúdo. O tema claro usa papel quente e mantém a mesma hierarquia. O amarelo do símbolo marca ações prioritárias e a seleção atual. Verde indica operação normal, laranja pede atenção e vermelho indica falha. Todo estado tem rótulo visível.

A Visão geral começa com o estado do robô para administradores. Uma lista de pendências relaciona cada empresa ao próximo passo. Os indicadores usam a mesma faixa, com uma divisão por função. A tabela de execuções é o elemento central. A configuração do escritório ocupa uma linha recolhível enquanto houver etapas pendentes.

## Sistema

- IBM Plex Sans para leitura e controles, Bricolage Grotesque para títulos e IBM Plex Mono para caminhos ou código. As tabelas usam números tabulares.
- Fundo em `--papel`, superfícies em `--superficie`, seleção em `--selecionado` e divisores em `--linha`. `--texto`, `--suave` e `--forte` definem a hierarquia de texto. O CSS registra os valores por tema.
- Divisores agrupam conteúdo na mesma superfície. Painéis com borda delimitam formulários e áreas de interação. Sombras ficam reservadas a elementos sobrepostos.
- A navegação preserva as rotas e a ordem do painel. No celular, a navegação compacta mostra todas as rotas. A tabela de execuções mantém as linhas e distribui as colunas com seus rótulos em telas estreitas. Tabelas largas usam rolagem local onde a comparação entre colunas é essencial.
- Controles nativos e affordances dos componentes existentes preservam foco, teclado e retorno de erros. Animações pontuais de processamento e transições de cor respeitam a preferência por movimento reduzido.

## Dados operacionais

A faixa de indicadores usa as contagens do servidor. A taxa de sucesso divide as tarefas realizadas (incluindo as consultas sem movimento) pelo total de tarefas finalizadas com sucesso ou falha. Tarefas em andamento e canceladas ficam fora desse denominador.

O último sinal dos robôs é visível a administradores. Um primeiro sinal registrado conclui a etapa de configuração, enquanto a conectividade indica se houve comunicação dentro da janela de dois minutos.

/* =====================================================================================
   Dicionário de Dados — Sistema MLG Comércio
   Fonte única: mlg_comercio_ddl.sql v1.2 (12 tabelas, 102 colunas, 16 chaves estrangeiras)
   Requisitos de referência: Especificação de Requisitos e Regras de Negócio v1.3
   ===================================================================================== */

'use strict';

/* -------------------------------------------------------------------------------------
   1. Configuração de caminhos (respeite maiúsculas e minúsculas no GitHub Pages)
   ------------------------------------------------------------------------------------- */
const CONFIG = {
  pdf: 'docs/Especificacao_Requisitos_Regras_Negocio_BD.pdf',
  der: 'assets/der.png'
};

/* -------------------------------------------------------------------------------------
   2. Controle de acesso por tabela (matriz RBAC — seção 3.1 dos requisitos)
      C = criar, R = ler, U = alterar, I = inativar, "—" = negado
   ------------------------------------------------------------------------------------- */
const RBAC = {
  escola:    'Operador: R | Gerente: C R U I | Administrador: C R U I',
  cliente:   'Operador: C R U | Gerente: C R U I | Administrador: C R U I + anonimizar',
  usuario:   'Operador: U (própria senha) | Gerente: U (própria senha) | Administrador: C R U I',
  catalogo:  'Operador: R | Gerente: C R U I | Administrador: C R U I',
  historico: 'Operador: — | Gerente: R | Administrador: R (gravação somente pelo gatilho trg_produto_au)',
  pedido:    'Operador: C R U (somente Aberto) | Gerente: C R U | Administrador: C R U',
  cancel:    'Operador: — | Gerente: C R | Administrador: C R',
  estoque:   'Operador: R | Gerente: C R (entrada e ajuste) | Administrador: C R',
  log:       'Operador: — | Gerente: — | Administrador: R pela visão vw_log_auditoria (gravação somente por sp_registrar_auditoria)',
  titular:   'Operador: — | Gerente: — | Administrador: C R U'
};

/* -------------------------------------------------------------------------------------
   3. Dicionário de dados — todas as tabelas e colunas do DDL
      Campos de coluna: n = atributo, d = descrição/regra, t = tipo, c = constraints,
      p = privacidade (DPS | DP | NA), o = origem, x = destino, a = acesso (opcional;
      quando ausente, vale o acesso da tabela)
   ------------------------------------------------------------------------------------- */
const TABELAS = [
  /* ================================================================== escola */
  {
    nome: 'escola',
    titulo: 'Escola (unidade de venda)',
    dominio: 'Cadastros',
    finalidade: 'Escola parceira que atua como unidade de venda independente: reúne os pedidos da sua comunidade, concentra os recebimentos e presta contas separadamente (RF01, RN28).',
    requisitos: 'RF01, RF19, RF20, RF21 | RN20, RN21, RN22, RN26, RN28',
    retencao: 'Permanente. Exclusão física bloqueada (trg_escola_bd); encerramento por inativação.',
    relacionamentos: 'escola 1:N pedido',
    objetos: 'trg_escola_ai, trg_escola_au, trg_escola_bd, sp_salvar_escola, vw_escola_selecao, vw_escola',
    rbac: RBAC.escola,
    colunas: [
      { n: 'id_escola', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Identificador substituto da escola, gerado pelo SGBD e nunca reaproveitado.',
        o: 'Gerado no INSERT de sp_salvar_escola.', x: 'pedido.id_escola; visões agrupadas por escola (RN28).' },
      { n: 'nome_escola', t: 'VARCHAR(100)', c: ['NOT NULL', 'UNIQUE (uk_escola_nome)'], p: 'NA',
        d: 'Nome da unidade de venda; não se repete entre escolas (RN20).',
        o: 'Tela Cadastro de Escolas (RF01), via sp_salvar_escola.', x: 'vw_devedores, vw_prestacao_contas_escola, vw_comprovante_pedido, relatórios RF18 a RF21.' },
      { n: 'nome_responsavel', t: 'VARCHAR(100)', c: ['NOT NULL'], p: 'DP',
        d: 'Nome da pessoa responsável pela escola, que recebe a prestação de contas e a lista de devedores (PR04).',
        o: 'Tela Cadastro de Escolas (RF01).', x: 'vw_escola (Gerente); prestação de contas (uso interno); log_auditoria somente como hash SHA-256.' },
      { n: 'telefone_responsavel', t: 'VARCHAR(11)', c: ['NOT NULL', 'CHECK ck_escola_telefone (DDD + 8 ou 9 dígitos, sem máscara)'], p: 'DP',
        d: 'Telefone de contato do responsável: 10 ou 11 dígitos, sem máscara, validado por expressão regular.',
        o: 'Tela Cadastro de Escolas, validado em sp_salvar_escola.', x: 'Contato da prestação de contas; log_auditoria somente como hash SHA-256.' },
      { n: 'taxa_lucro_percentual', t: 'DECIMAL(5,2)', c: ['NOT NULL', 'DEFAULT 0.00', 'CHECK ck_escola_taxa_lucro (0 a 100)'], p: 'NA',
        d: 'Percentual usado no lucro estimado da unidade (RF21, RN26). Valor percentual, nunca FLOAT (RNF20).',
        o: 'Configuração da taxa de lucro (RF21).', x: 'vw_lucro_estimado_escola (lucro calculado na consulta, sem armazenamento).' },
      { n: 'ativo', t: 'TINYINT(1)', c: ['NOT NULL', 'DEFAULT 1', 'CHECK ck_escola_ativo (0 ou 1)'], p: 'NA',
        d: 'Exclusão lógica (RN22). Escola inativa não recebe novos pedidos (RN21, trg_pedido_bi), mas permanece nos relatórios.',
        o: 'sp_salvar_escola (Gerente).', x: 'Validação de trg_pedido_bi; filtros de seleção da aplicação.' },
      { n: 'data_cadastro', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP'], p: 'NA',
        d: 'Momento do cadastro, gravado pelo servidor.',
        o: 'Relógio do servidor MySQL.', x: 'Consulta de cadastro e auditoria.' }
    ]
  },

  /* ================================================================== cliente */
  {
    nome: 'cliente',
    titulo: 'Cliente (titular de dados pessoais)',
    dominio: 'Cadastros',
    finalidade: 'Pessoa que realiza pedidos em uma ou mais escolas, com base única identificada pelo telefone (solução do gargalo G1). Contém os dados pessoais tratados pelo sistema, sob a LGPD (RF02, PR03).',
    requisitos: 'RF02, RF03, RF17, RF26 | RN19, RN22, RN37 | PR03',
    retencao: 'Enquanto houver vínculo com pedidos (PR01). Exclusão física bloqueada (trg_cliente_bd); a pedido do titular, anonimização irreversível (sp_anonimizar_cliente).',
    relacionamentos: 'cliente 1:N pedido; cliente 1:N solicitacao_titular',
    objetos: 'trg_cliente_bu, trg_cliente_ai, trg_cliente_au, trg_cliente_bd, sp_salvar_cliente, sp_buscar_cliente, sp_anonimizar_cliente, sp_exportar_dados_titular, vw_historico_cliente',
    rbac: RBAC.cliente,
    colunas: [
      { n: 'id_cliente', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'DP',
        d: 'Identificador substituto do cliente. Identificador indireto do titular: permite associá-lo aos pedidos.',
        o: 'Gerado no INSERT de sp_salvar_cliente ou pelo script de migração do legado (RNF12).', x: 'pedido.id_cliente, solicitacao_titular.id_cliente, vw_historico_cliente.' },
      { n: 'nome_cliente', t: 'VARCHAR(100)', c: ['NOT NULL', 'INDEX idx_cliente_nome'], p: 'DP',
        d: 'Nome do cliente. Na anonimização é substituído por "Cliente anonimizado #id" (PR03).',
        o: 'Tela Cadastro de Clientes (RF02) ou migração do legado SQLite (RNF12).', x: 'sp_buscar_cliente, vw_devedores, vw_comprovante_pedido, vw_historico_cliente; log_auditoria somente como hash SHA-256.' },
      { n: 'telefone', t: 'VARCHAR(11)', c: ['NULL', 'UNIQUE (uk_cliente_telefone)', 'CHECK ck_cliente_telefone_formato', 'CHECK ck_cliente_telefone_obrigatorio'], p: 'DP',
        d: 'Identificador de negócio do cliente (RN19): DDD e número, 10 ou 11 dígitos, sem máscara. Obrigatório enquanto o cliente não for anonimizado; após a anonimização fica NULL.',
        o: 'Tela Cadastro de Clientes; a migração unifica os clientes das escolas pelo telefone (RNF12).', x: 'Busca de cliente (RF03); vw_devedores e vw_historico_cliente (completo e mascarado); log_auditoria somente como hash SHA-256.',
        a: 'Operador: somente mascarado (fn_mascarar_telefone) | Gerente: completo | Administrador: completo (RNF05)' },
      { n: 'email', t: 'VARCHAR(255)', c: ['NULL', 'CHECK ck_cliente_email (formato básico)'], p: 'DP',
        d: 'E-mail opcional do cliente; texto vazio é gravado como NULL.',
        o: 'Tela Cadastro de Clientes (RF02).', x: 'sp_exportar_dados_titular (acesso e portabilidade); log_auditoria somente como hash SHA-256.' },
      { n: 'data_ciencia_privacidade', t: 'DATETIME', c: ['NOT NULL'], p: 'DP',
        d: 'Momento em que o cliente recebeu o aviso de privacidade; sem a confirmação o cadastro é rejeitado (PR03).',
        o: 'Confirmação na tela de cadastro; gravado com NOW() por sp_salvar_cliente.', x: 'sp_exportar_dados_titular; prova de transparência (LGPD, art. 6º, VI).' },
      { n: 'anonimizado', t: 'TINYINT(1)', c: ['NOT NULL', 'DEFAULT 0', 'CHECK ck_cliente_anonimizacao', 'CHECK ck_cliente_flags'], p: 'NA',
        d: 'Indica anonimização irreversível: exige ativo = 0, telefone e e-mail NULL e data_anonimizacao preenchida. Depois disso o registro não pode ser alterado (trg_cliente_bu).',
        o: 'sp_anonimizar_cliente (Administrador, RF26).', x: 'trg_pedido_bi (RN37); sp_buscar_cliente exclui anonimizados.' },
      { n: 'data_anonimizacao', t: 'DATETIME', c: ['NULL'], p: 'NA',
        d: 'Momento da anonimização; obrigatória quando anonimizado = 1.',
        o: 'sp_anonimizar_cliente.', x: 'Comprovação do atendimento ao titular (RF26).' },
      { n: 'ativo', t: 'TINYINT(1)', c: ['NOT NULL', 'DEFAULT 1', 'CHECK ck_cliente_flags'], p: 'NA',
        d: 'Inativação reversível (exige perfil Gerente). Cliente inativo não recebe novos pedidos (RN37).',
        o: 'sp_salvar_cliente.', x: 'trg_pedido_bi.' },
      { n: 'data_cadastro', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP'], p: 'NA',
        d: 'Momento do cadastro; protegida contra alteração por trg_cliente_bu.',
        o: 'Relógio do servidor MySQL.', x: 'sp_exportar_dados_titular.' }
    ]
  },

  /* ================================================================== usuario */
  {
    nome: 'usuario',
    titulo: 'Usuário do sistema',
    dominio: 'Segurança',
    finalidade: 'Pessoa que opera o sistema com perfil de acesso (Operador, Gerente ou Administrador). O registro id 1, login "sistema", é o usuário técnico usado pelos gatilhos sem sessão (RN03).',
    requisitos: 'RF24, RF30 | RN03, RN20, RN22 | RNF02, RNF28',
    retencao: 'Permanente. Exclusão física bloqueada (trg_usuario_bd); encerramento por inativação.',
    relacionamentos: 'usuario 1:N pedido, historico_preco, movimentacao_estoque, cancelamento_pedido, log_auditoria; usuario 0..1:N solicitacao_titular',
    objetos: 'trg_usuario_ai, trg_usuario_au, trg_usuario_bd, vw_usuario, sp_obter_credencial, sp_abrir_sessao, sp_encerrar_sessao, sp_trocar_senha, sp_salvar_usuario, sp_desbloquear_usuario, fn_usuario_sessao, fn_nivel_perfil, sp_exigir_perfil',
    rbac: RBAC.usuario,
    colunas: [
      { n: 'id_usuario', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'DP',
        d: 'Identificador do usuário; identifica o colaborador responsável por cada operação (RN03).',
        o: 'Gerado no INSERT de sp_salvar_usuario; id 1 criado na carga inicial.', x: '@id_usuario_sessao; chaves estrangeiras de pedido, historico_preco, movimentacao_estoque, cancelamento_pedido, log_auditoria e solicitacao_titular.' },
      { n: 'nome_usuario', t: 'VARCHAR(100)', c: ['NOT NULL'], p: 'DP',
        d: 'Nome do colaborador.',
        o: 'Gestão de usuários (RF24).', x: 'vw_usuario, vw_extrato_estoque, vw_historico_preco, vw_pedido_consulta, vw_log_auditoria; log_auditoria somente como hash SHA-256.' },
      { n: 'login', t: 'VARCHAR(30)', c: ['NOT NULL', 'UNIQUE (uk_usuario_login)'], p: 'DP',
        d: 'Identificação de acesso, única (RN20). O valor "sistema" é reservado ao usuário técnico e não autentica.',
        o: 'Gestão de usuários (RF24).', x: 'sp_obter_credencial, sp_abrir_sessao.' },
      { n: 'senha_hash', t: 'VARCHAR(255)', c: ['NOT NULL'], p: 'DP',
        d: 'Credencial armazenada somente como hash bcrypt de custo 12 ou superior, ou Argon2id (RNF02); nunca em texto puro. A senha original tem de 10 a 64 caracteres (RNF28).',
        o: 'Hash gerado pela aplicação; gravado por sp_salvar_usuario, sp_trocar_senha ou sp_desbloquear_usuario.', x: 'sp_obter_credencial (validação da senha pela aplicação). Nunca exibido; fora de vw_usuario; a auditoria registra só o indicador senha_alterada.',
        a: 'Nenhum perfil lê a coluna; somente a aplicação, por sp_obter_credencial, para validar o login. Classificação: confidencial.' },
      { n: 'perfil', t: 'VARCHAR(13)', c: ['NOT NULL', 'CHECK ck_usuario_perfil (Operador, Gerente, Administrador)'], p: 'NA',
        d: 'Perfil de acesso, com hierarquia Administrador > Gerente > Operador (fn_nivel_perfil).',
        o: 'Gestão de usuários (Administrador).', x: 'sp_exigir_perfil (validação de cada procedimento); máscara de telefone em sp_buscar_cliente.' },
      { n: 'tentativas_login_falhas', t: 'TINYINT UNSIGNED', c: ['NOT NULL', 'DEFAULT 0'], p: 'NA',
        d: 'Contador de falhas consecutivas; na 5ª falha o acesso é bloqueado por 15 minutos e o contador é zerado (RNF28).',
        o: 'sp_abrir_sessao.', x: 'Política de bloqueio; sp_desbloquear_usuario zera o contador.' },
      { n: 'data_bloqueio_ate', t: 'DATETIME', c: ['NULL'], p: 'NA',
        d: 'Fim do bloqueio temporário de acesso; NULL quando o usuário não está bloqueado.',
        o: 'sp_abrir_sessao.', x: 'sp_obter_credencial (indicador "bloqueado"); sp_desbloquear_usuario.' },
      { n: 'data_ultimo_acesso', t: 'DATETIME', c: ['NULL'], p: 'DP',
        d: 'Momento do último login bem-sucedido (dado comportamental do colaborador).',
        o: 'sp_abrir_sessao.', x: 'Gestão de usuários (RF24).' },
      { n: 'ativo', t: 'TINYINT(1)', c: ['NOT NULL', 'DEFAULT 1', 'CHECK ck_usuario_ativo (0 ou 1)'], p: 'NA',
        d: 'Usuário inativo não acessa o sistema (RN22). O Administrador não pode inativar o próprio usuário.',
        o: 'sp_salvar_usuario.', x: 'sp_abrir_sessao, sp_exigir_perfil.' },
      { n: 'data_cadastro', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP'], p: 'NA',
        d: 'Momento do cadastro, gravado pelo servidor.',
        o: 'Relógio do servidor MySQL.', x: 'Gestão de usuários.' }
    ]
  },

  /* ================================================================== categoria */
  {
    nome: 'categoria',
    titulo: 'Categoria de produto',
    dominio: 'Catálogo',
    finalidade: 'Agrupamento dos produtos do catálogo. Carga inicial: Queijos, Requeijões, Doces, Mel, Embutidos e Bebidas Artesanais (RF04).',
    requisitos: 'RF04, RF15 | RN20, RN22, RN38',
    retencao: 'Permanente. Exclusão física bloqueada (trg_categoria_bd); encerramento por inativação.',
    relacionamentos: 'categoria 1:N produto',
    objetos: 'trg_categoria_bu, trg_categoria_ai, trg_categoria_au, trg_categoria_bd, sp_salvar_categoria, vw_categoria',
    rbac: RBAC.catalogo,
    colunas: [
      { n: 'id_categoria', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Identificador da categoria.',
        o: 'Gerado no INSERT de sp_salvar_categoria ou na carga inicial.', x: 'produto.id_categoria.' },
      { n: 'nome_categoria', t: 'VARCHAR(60)', c: ['NOT NULL', 'UNIQUE (uk_categoria_nome)'], p: 'NA',
        d: 'Nome da categoria, único (RN20).',
        o: 'Gestão de categorias (RF04).', x: 'vw_posicao_estoque, sp_rel_consolidacao_encomendas.' },
      { n: 'ativo', t: 'TINYINT(1)', c: ['NOT NULL', 'DEFAULT 1', 'CHECK ck_categoria_ativo (0 ou 1)'], p: 'NA',
        d: 'Categoria inativa impede a venda dos seus produtos; só é inativada sem produto ativo ou junto com eles na mesma transação (RN38).',
        o: 'sp_salvar_categoria.', x: 'trg_categoria_bu, trg_produto_bi, trg_produto_bu, trg_item_pedido_bi.' },
      { n: 'data_cadastro', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP'], p: 'NA',
        d: 'Momento do cadastro, gravado pelo servidor.',
        o: 'Relógio do servidor MySQL.', x: 'Consulta de cadastro.' }
    ]
  },

  /* ================================================================== produto */
  {
    nome: 'produto',
    titulo: 'Produto (catálogo e saldo em estoque)',
    dominio: 'Catálogo',
    finalidade: 'Item artesanal comercializado pela MLG, com preço de tabela vigente, custo de aquisição, saldo e estoque mínimo e registro de inspeção sanitária (RF05, PR07).',
    requisitos: 'RF05, RF06, RF15, RF22, RF27 a RF29 | RN07, RN20, RN22, RN23, RN24, RN29, RN31, RN36, RN38 | PR07',
    retencao: 'Permanente. Exclusão física bloqueada (trg_produto_bd); encerramento por inativação.',
    relacionamentos: 'produto N:1 categoria; produto 1:N item_pedido, historico_preco, movimentacao_estoque',
    objetos: 'trg_produto_bi, trg_produto_bu, trg_produto_ai, trg_produto_au, trg_produto_bd, sp_salvar_produto, vw_catalogo_produto, vw_produto_gestao, vw_posicao_estoque, vw_estoque_reposicao, vw_conferencia_estoque',
    rbac: RBAC.catalogo,
    colunas: [
      { n: 'id_produto', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Identificador do produto; os bloqueios de concorrência são adquiridos em ordem crescente deste id (RNF25).',
        o: 'Gerado no INSERT de sp_salvar_produto.', x: 'item_pedido, historico_preco, movimentacao_estoque.' },
      { n: 'id_categoria', t: 'INT UNSIGNED', c: ['FK → categoria.id_categoria (fk_produto_categoria)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX fk_produto_categoria_idx'], p: 'NA',
        d: 'Categoria do produto; deve estar ativa no cadastro (trg_produto_bi) e na reativação (trg_produto_bu).',
        o: 'Gestão do catálogo (RF05).', x: 'vw_posicao_estoque, sp_rel_consolidacao_encomendas.' },
      { n: 'nome_produto', t: 'VARCHAR(100)', c: ['NOT NULL', 'UNIQUE (uk_produto_nome)'], p: 'NA',
        d: 'Nome comercial do produto, único (RN20).',
        o: 'Gestão do catálogo (RF05).', x: 'Comprovante (RF10), relatórios de estoque, margem e indicadores.' },
      { n: 'preco_atual', t: 'DECIMAL(10,2)', c: ['NOT NULL', 'CHECK ck_produto_preco_atual (maior que 0)'], p: 'NA',
        d: 'Preço de tabela vigente (RN24). Cada reajuste gera um registro em historico_preco (RN23).',
        o: 'Gestão do catálogo (Gerente).', x: 'Copiado para item_pedido.preco_unitario_praticado na venda (RN05); historico_preco.' },
      { n: 'preco_custo', t: 'DECIMAL(10,2)', c: ['NULL', 'CHECK ck_produto_preco_custo (NULL ou maior ou igual a 0)'], p: 'NA',
        d: 'Custo de aquisição; NULL quando não informado, nunca tratado como zero (RN24, G4).',
        o: 'Gestão do catálogo (Gerente).', x: 'Copiado para item_pedido.custo_unitario_praticado (RN06); vw_produto_gestao, vw_margem_produto. Fora de vw_catalogo_produto.',
        a: 'Operador: — (sem necessidade) | Gerente: C R U | Administrador: C R U' },
      { n: 'estoque_atual', t: 'INT', c: ['NOT NULL', 'DEFAULT 0', 'CHECK ck_produto_estoque_atual (maior ou igual a 0)'], p: 'NA',
        d: 'Saldo em estoque. Redundância controlada: igual à soma das movimentações (RN31, RNF24). Começa em zero (trg_produto_bi) e só é alterado por movimentação (trg_produto_bu).',
        o: 'trg_movimentacao_estoque_ai (saldo_posterior da movimentação).', x: 'vw_posicao_estoque, vw_estoque_reposicao, vw_validade_proxima, vw_conferencia_estoque, sp_rel_consolidacao_encomendas.',
        a: 'Todos os perfis: R | Alteração exclusiva por movimentação de estoque (RN31)' },
      { n: 'estoque_minimo', t: 'INT', c: ['NOT NULL', 'DEFAULT 0', 'CHECK ck_produto_estoque_minimo (maior ou igual a 0)'], p: 'NA',
        d: 'Quantidade de referência: saldo igual ou abaixo dela sinaliza reposição (RN36).',
        o: 'Gestão do catálogo (Gerente).', x: 'vw_posicao_estoque (abaixo_do_minimo), vw_estoque_reposicao.' },
      { n: 'registro_inspecao', t: 'VARCHAR(30)', c: ['NULL'], p: 'NA',
        d: 'Registro de inspeção sanitária: SIF, SIE, SIM ou Selo Arte; NULL para produto sem registro (PR07).',
        o: 'Gestão do catálogo (RF05).', x: 'Rastreabilidade sanitária (Lei nº 13.680/2018).' },
      { n: 'ativo', t: 'TINYINT(1)', c: ['NOT NULL', 'DEFAULT 1', 'CHECK ck_produto_ativo (0 ou 1)'], p: 'NA',
        d: 'Produto inativo não entra em novos pedidos (RN07), mas permanece nos pedidos registrados.',
        o: 'sp_salvar_produto ou inativação em cascata por sp_salvar_categoria (RN38).', x: 'trg_item_pedido_bi, vw_posicao_estoque.' },
      { n: 'data_cadastro', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP'], p: 'NA',
        d: 'Momento do cadastro, gravado pelo servidor.',
        o: 'Relógio do servidor MySQL.', x: 'Consulta de cadastro.' }
    ]
  },

  /* ================================================================== historico_preco */
  {
    nome: 'historico_preco',
    titulo: 'Histórico de preços',
    dominio: 'Catálogo',
    finalidade: 'Registro imutável de cada reajuste do preço de tabela de um produto, com valores anterior e novo, data e responsável (RF06, RN23).',
    requisitos: 'RF06 | RN05, RN23',
    retencao: 'Permanente. Registro imutável (trg_historico_preco_bu e trg_historico_preco_bd).',
    relacionamentos: 'historico_preco N:1 produto; historico_preco N:1 usuario',
    objetos: 'trg_produto_au (gravação), trg_historico_preco_bu, trg_historico_preco_bd, vw_historico_preco (consulta)',
    rbac: RBAC.historico,
    colunas: [
      { n: 'id_historico_preco', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Identificador do registro de reajuste.',
        o: 'Gerado no INSERT feito por trg_produto_au.', x: 'vw_historico_preco (RF06).' },
      { n: 'id_produto', t: 'INT UNSIGNED', c: ['FK → produto.id_produto (fk_historico_preco_produto)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX idx_historico_produto_data'], p: 'NA',
        d: 'Produto reajustado.',
        o: 'trg_produto_au (NEW.id_produto).', x: 'Consulta por produto e período (RF06).' },
      { n: 'id_usuario', t: 'INT UNSIGNED', c: ['FK → usuario.id_usuario (fk_historico_preco_usuario)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX fk_historico_preco_usuario_idx'], p: 'DP',
        d: 'Usuário responsável pelo reajuste.',
        o: 'fn_usuario_sessao() no gatilho trg_produto_au.', x: 'Responsabilização (RN03).' },
      { n: 'preco_anterior', t: 'DECIMAL(10,2)', c: ['NOT NULL', 'CHECK ck_historico_preco_valores (maior que 0)'], p: 'NA',
        d: 'Preço de tabela antes do reajuste. Redundância controlada: registro histórico imutável (seção 6.3).',
        o: 'OLD.preco_atual de produto.', x: 'Análise de reajustes.' },
      { n: 'preco_novo', t: 'DECIMAL(10,2)', c: ['NOT NULL', 'CHECK ck_historico_preco_valores (maior que 0)'], p: 'NA',
        d: 'Preço de tabela após o reajuste.',
        o: 'NEW.preco_atual de produto.', x: 'Análise de reajustes.' },
      { n: 'data_alteracao', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP', 'INDEX idx_historico_produto_data'], p: 'NA',
        d: 'Momento do reajuste, gravado pelo servidor.',
        o: 'Relógio do servidor MySQL.', x: 'Filtro por período (RF06).' }
    ]
  },

  /* ================================================================== pedido */
  {
    nome: 'pedido',
    titulo: 'Pedido (encomenda)',
    dominio: 'Vendas',
    finalidade: 'Encomenda de um cliente em uma escola, com a situação do pedido separada da situação e da forma de pagamento (solução do gargalo G3). Controla o fiado ("Folha"), a quitação, a entrega e o cancelamento (RF07, RF11 a RF14).',
    requisitos: 'RF07, RF09, RF11 a RF14, RF16 a RF22 | RN01 a RN04, RN10 a RN17, RN21, RN25, RN30, RN37, RN39 | PR01, PR02, PR06',
    retencao: '6 anos a partir da data do pedido (PR01, RNF29). Pedidos Pendentes não são expurgados (PR06). Exclusão física bloqueada fora do expurgo.',
    relacionamentos: 'pedido N:1 escola, cliente, usuario; pedido 1:N item_pedido; pedido 1:0..1 cancelamento_pedido; pedido 0..1:N movimentacao_estoque',
    objetos: 'trg_pedido_bi, trg_pedido_bu, trg_pedido_au, trg_pedido_ai, trg_pedido_bd, trg_pedido_ad, sp_registrar_pedido, sp_aplicar_desconto, sp_quitar_pedido, sp_registrar_entrega, sp_registrar_entrega_escola, sp_cancelar_pedido, vw_pedido_consulta, vw_conferencia_pedido, vw_devedores, vw_prestacao_contas_escola',
    rbac: RBAC.pedido,
    colunas: [
      { n: 'id_pedido', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Número do pedido, usado no comprovante (RF10).',
        o: 'Gerado no INSERT de sp_registrar_pedido ou pela migração do legado (RNF12).', x: 'item_pedido, cancelamento_pedido, movimentacao_estoque, comprovante e relatórios.' },
      { n: 'id_escola', t: 'INT UNSIGNED', c: ['FK → escola.id_escola (fk_pedido_escola)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX idx_pedido_escola_status'], p: 'NA',
        d: 'Unidade de venda do pedido (RN01); deve estar ativa (RN21) e não pode ser trocada depois (trg_pedido_bu).',
        o: 'Tela de registro de pedido (RF07).', x: 'Apuração segregada por escola (RN28): vw_devedores, vw_prestacao_contas_escola, vw_indicadores_escola.' },
      { n: 'id_cliente', t: 'INT UNSIGNED', c: ['FK → cliente.id_cliente (fk_pedido_cliente)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX idx_pedido_cliente'], p: 'DP',
        d: 'Cliente do pedido (RN02); deve estar ativo e não anonimizado (RN37) e não pode ser trocado depois.',
        o: 'Localização do cliente (RF03) na tela de pedido.', x: 'vw_historico_cliente, vw_devedores, vw_comprovante_pedido, sp_exportar_dados_titular.' },
      { n: 'id_usuario', t: 'INT UNSIGNED', c: ['FK → usuario.id_usuario (fk_pedido_usuario)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX idx_pedido_usuario'], p: 'DP',
        d: 'Usuário que lançou o pedido (RN03); imutável.',
        o: '@id_usuario_sessao em sp_registrar_pedido.', x: 'Consulta de pedidos por responsável (RF16).' },
      { n: 'data_hora', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP', 'INDEX idx_pedido_data_hora'], p: 'NA',
        d: 'Momento do pedido, sempre gravado pelo servidor (trg_pedido_bi força NOW()) e imutável (RN17).',
        o: 'Relógio do servidor MySQL.', x: 'Filtros por período, prazo de arrependimento sem entrega (PR02), expurgo de 6 anos (RNF29).' },
      { n: 'status_pedido', t: 'VARCHAR(10)', c: ['NOT NULL', "DEFAULT 'Aberto'", 'CHECK ck_pedido_status_pedido (Aberto, Entregue, Cancelado)', 'CHECK ck_pedido_coerencia_cancelamento', 'CHECK ck_pedido_entregue_com_data', 'INDEX idx_pedido_escola_status'], p: 'NA',
        d: 'Situação do pedido (RN39). Transições: Aberto para Entregue, Aberto para Cancelado e Entregue para Cancelado (RN13). Cancelado é definitivo.',
        o: 'trg_pedido_bi (Aberto); trg_pedido_bu (Entregue na entrega); sp_cancelar_pedido (Cancelado).', x: 'Bloqueio de itens (RN14), vw_posicao_estoque, vw_indicadores_escola.' },
      { n: 'status_pagamento', t: 'VARCHAR(10)', c: ['NOT NULL', "DEFAULT 'Pendente'", 'CHECK ck_pedido_status_pagamento (Pendente, Pago, Estornado, Cancelado)', 'CHECK ck_pedido_coerencia_pagamento', 'INDEX idx_pedido_escola_status'], p: 'NA',
        d: 'Situação do pagamento (RN10). Pendente corresponde ao fiado ("Folha"). Transições: Pendente para Pago, Pendente para Cancelado e Pago para Estornado (RN13).',
        o: 'sp_registrar_pedido (Pago no ato), sp_quitar_pedido (RF12), sp_cancelar_pedido (RF13); migração converte "Folha" em Pendente (RNF12).', x: 'vw_devedores (Pendente), vw_prestacao_contas_escola, vw_margem_produto (Pago).' },
      { n: 'forma_pagamento', t: 'VARCHAR(10)', c: ['NULL', 'CHECK ck_pedido_forma_pagamento (Débito, Crédito, Pix, Dinheiro)', 'CHECK ck_pedido_coerencia_pagamento'], p: 'NA',
        d: 'Forma efetiva de pagamento (RN11); NULL em Pendente e Cancelado, obrigatória em Pago e Estornado (RN12). "Folha" não é forma de pagamento.',
        o: 'Informada pelo operador na venda ou na quitação.', x: 'Totais por forma de pagamento (RF19, RN25).' },
      { n: 'data_pagamento', t: 'DATETIME', c: ['NULL', 'CHECK ck_pedido_data_pagamento (maior ou igual a data_hora)', 'CHECK ck_pedido_coerencia_pagamento'], p: 'NA',
        d: 'Momento do pagamento; não pode ser anterior ao pedido (RN17) nem alterado depois de registrado.',
        o: 'NOW() em sp_registrar_pedido ou sp_quitar_pedido.', x: 'Prestação de contas e auditoria.' },
      { n: 'valor_desconto', t: 'DECIMAL(10,2)', c: ['NOT NULL', 'DEFAULT 0.00', 'CHECK ck_pedido_valor_desconto (maior ou igual a 0)'], p: 'NA',
        d: 'Desconto em valor sobre o subtotal; não pode superar o subtotal e só é alterado em pedido Aberto e Pendente (RN16).',
        o: 'sp_aplicar_desconto ou sp_registrar_pedido (perfil Gerente).', x: 'Recalcula valor_total em trg_pedido_bu (RN15).',
        a: 'Operador: R | Gerente: C U (RN16) | Administrador: C U' },
      { n: 'valor_total', t: 'DECIMAL(10,2)', c: ['NOT NULL', 'DEFAULT 0.00', 'CHECK ck_pedido_valor_total (maior ou igual a 0)'], p: 'NA',
        d: 'Soma de quantidade x preço praticado dos itens menos o desconto (RN15). Redundância controlada, conferida em vw_conferencia_pedido.',
        o: 'Gatilhos trg_item_pedido_ai, trg_item_pedido_au, trg_item_pedido_ad e trg_pedido_bu.', x: 'Comprovante, devedores, prestação de contas, ticket médio, limite do estorno (RN18).' },
      { n: 'data_entrega', t: 'DATE', c: ['NULL', 'CHECK ck_pedido_data_entrega (maior ou igual a DATE(data_hora))', 'CHECK ck_pedido_entregue_com_data'], p: 'NA',
        d: 'Data de entrega ao cliente. Ao ser preenchida muda o pedido para Entregue, baixa o estoque (RN30) e inicia o prazo de arrependimento de 7 dias (PR02). Não pode ser futura nem alterada depois.',
        o: 'sp_registrar_entrega ou sp_registrar_entrega_escola (RF14).', x: 'trg_pedido_au (movimentações de Saída), sp_cancelar_pedido (prazo e retorno ao estoque).' }
    ]
  },

  /* ================================================================== item_pedido */
  {
    nome: 'item_pedido',
    titulo: 'Item do pedido',
    dominio: 'Vendas',
    finalidade: 'Entidade associativa entre pedido e produto: cada produto do pedido com quantidade, preço e custo congelados no momento da venda (solução do gargalo G2, RF07, RF08).',
    requisitos: 'RF07, RF08, RF10, RF15, RF20, RF22 | RN04 a RN09, RN14, RN15, RN16, RN27, RN35 | PR05',
    retencao: '6 anos, junto com o pedido (PR01). Exclusão permitida somente em pedido Aberto, Pendente e não entregue, preservando ao menos um item.',
    relacionamentos: 'item_pedido N:1 pedido; item_pedido N:1 produto (resolve o N:N pedido x produto)',
    objetos: 'trg_item_pedido_bi, trg_item_pedido_bu, trg_item_pedido_bd, trg_item_pedido_ai, trg_item_pedido_au, trg_item_pedido_ad, sp_alterar_item_pedido, vw_comprovante_pedido, vw_margem_produto',
    rbac: RBAC.pedido,
    colunas: [
      { n: 'id_item_pedido', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Chave substituta do item, exigida por log_auditoria.id_registro_afetado (seção 6.3).',
        o: 'Gerado no INSERT de sp_registrar_pedido ou sp_alterar_item_pedido.', x: 'log_auditoria.' },
      { n: 'id_pedido', t: 'INT UNSIGNED', c: ['FK → pedido.id_pedido (fk_item_pedido_pedido)', 'NOT NULL', 'ON DELETE RESTRICT', 'UNIQUE (uk_item_pedido_produto: id_pedido + id_produto)'], p: 'NA',
        d: 'Pedido a que o item pertence; não pode ser trocado (trg_item_pedido_bu).',
        o: 'sp_registrar_pedido.', x: 'Recalculo de pedido.valor_total (RN15).' },
      { n: 'id_produto', t: 'INT UNSIGNED', c: ['FK → produto.id_produto (fk_item_pedido_produto)', 'NOT NULL', 'ON DELETE RESTRICT', 'UNIQUE (uk_item_pedido_produto)', 'INDEX idx_item_produto'], p: 'NA',
        d: 'Produto vendido; produto e categoria devem estar ativos (RN07, RN38) e aparecem uma única vez por pedido (RN09).',
        o: 'Itens em JSON de sp_registrar_pedido; migração do texto livre do legado (RNF12).', x: 'Consolidação de encomendas (RF15), produto mais vendido (RF20), baixa de estoque (RN30).' },
      { n: 'quantidade', t: 'INT', c: ['NOT NULL', 'CHECK ck_item_pedido_quantidade (maior que 0)'], p: 'NA',
        d: 'Quantidade inteira e positiva (RN08). Itens repetidos no JSON são somados.',
        o: 'Tela de pedido; sp_alterar_item_pedido (quantidade 0 remove o item).', x: 'valor_total, movimentações de Saída e Devolução, sp_rel_consolidacao_encomendas.' },
      { n: 'preco_unitario_praticado', t: 'DECIMAL(10,2)', c: ['NOT NULL', 'CHECK ck_item_pedido_precos (maior ou igual a 0)'], p: 'NA',
        d: 'Preço de tabela congelado no momento da venda (RN05); não muda com reajustes posteriores nem por UPDATE.',
        o: 'Copiado de produto.preco_atual por trg_item_pedido_bi.', x: 'Comprovante (RF10, PR05), valor_total, vw_margem_produto.' },
      { n: 'custo_unitario_praticado', t: 'DECIMAL(10,2)', c: ['NULL', 'CHECK ck_item_pedido_precos (NULL ou maior ou igual a 0)'], p: 'NA',
        d: 'Custo congelado no momento da venda (RN06); NULL quando o custo não foi cadastrado, totalizado à parte como "custo não informado" (RN27).',
        o: 'Copiado de produto.preco_custo por trg_item_pedido_bi.', x: 'vw_margem_produto (RF22).',
        a: 'Operador: — | Gerente: R | Administrador: R (margem real, RF22)' }
    ]
  },

  /* ================================================================== cancelamento_pedido */
  {
    nome: 'cancelamento_pedido',
    titulo: 'Cancelamento e estorno',
    dominio: 'Vendas',
    finalidade: 'Registro imutável do cancelamento de um pedido, com motivo, indicação de arrependimento (CDC, art. 49), estorno ao cliente e eventual retorno dos produtos ao estoque (RF13).',
    requisitos: 'RF13, RF19 | RN18, RN25, RN33, RN40 | PR02',
    retencao: '6 anos, junto com o pedido (PR01). Imutável (trg_cancelamento_pedido_bu e trg_cancelamento_pedido_bd).',
    relacionamentos: 'cancelamento_pedido 0..1:1 pedido; cancelamento_pedido N:1 usuario',
    objetos: 'trg_cancelamento_pedido_bi, trg_cancelamento_pedido_bu, trg_cancelamento_pedido_bd, trg_cancelamento_pedido_ai, trg_cancelamento_pedido_ad, sp_cancelar_pedido',
    rbac: RBAC.cancel,
    colunas: [
      { n: 'id_cancelamento_pedido', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Identificador do cancelamento.',
        o: 'Gerado no INSERT de sp_cancelar_pedido.', x: 'log_auditoria.' },
      { n: 'id_pedido', t: 'INT UNSIGNED', c: ['FK → pedido.id_pedido (fk_cancelamento_pedido_pedido)', 'NOT NULL', 'ON DELETE RESTRICT', 'UNIQUE (uk_cancelamento_pedido)'], p: 'NA',
        d: 'Pedido cancelado; no máximo um cancelamento por pedido (RN18).',
        o: 'sp_cancelar_pedido.', x: 'vw_prestacao_contas_escola, sp_rel_prestacao_contas (total estornado).' },
      { n: 'id_usuario', t: 'INT UNSIGNED', c: ['FK → usuario.id_usuario (fk_cancelamento_pedido_usuario)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX fk_cancelamento_pedido_usuario_idx'], p: 'DP',
        d: 'Gerente ou Administrador que cancelou.',
        o: '@id_usuario_sessao em sp_cancelar_pedido.', x: 'Responsabilização (RN03).' },
      { n: 'data_cancelamento', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP'], p: 'NA',
        d: 'Momento do cancelamento, sempre gravado pelo servidor (trg_cancelamento_pedido_bi força NOW()).',
        o: 'Relógio do servidor MySQL.', x: 'Auditoria e expurgo.' },
      { n: 'motivo_cancelamento', t: 'VARCHAR(255)', c: ['NOT NULL', 'CHECK ck_cancelamento_motivo (não vazio)'], p: 'NA',
        d: 'Motivo obrigatório (RN18). Texto livre: oriente os usuários a não registrar dados pessoais nesta coluna.',
        o: 'Informado pelo Gerente em sp_cancelar_pedido.', x: 'log_auditoria (JSON).' },
      { n: 'arrependimento', t: 'TINYINT(1)', c: ['NOT NULL', 'DEFAULT 0', 'CHECK ck_cancelamento_flags (0 ou 1)'], p: 'NA',
        d: 'Indica direito de arrependimento (CDC, art. 49): até 7 dias do recebimento ou, sem entrega, da contratação; com pedido pago, o estorno é integral (RN40).',
        o: 'sp_cancelar_pedido.', x: 'Validação de trg_cancelamento_pedido_bi.' },
      { n: 'valor_estornado', t: 'DECIMAL(10,2)', c: ['NOT NULL', 'DEFAULT 0.00', 'CHECK ck_cancelamento_valor (maior ou igual a 0)', 'CHECK ck_cancelamento_estorno'], p: 'NA',
        d: 'Valor devolvido ao cliente; não supera pedido.valor_total (RN18); pedido não pago não gera estorno.',
        o: 'sp_cancelar_pedido (integral no arrependimento).', x: 'Total recebido líquido e total estornado (RN25, RF19).' },
      { n: 'forma_estorno', t: 'VARCHAR(10)', c: ['NULL', 'CHECK ck_cancelamento_forma (Débito, Crédito, Pix, Dinheiro)', 'CHECK ck_cancelamento_estorno'], p: 'NA',
        d: 'Forma da devolução; obrigatória quando valor_estornado é maior que zero.',
        o: 'sp_cancelar_pedido.', x: 'Prestação de contas.' },
      { n: 'data_estorno', t: 'DATETIME', c: ['NULL', 'CHECK ck_cancelamento_estorno'], p: 'NA',
        d: 'Momento do estorno; obrigatório quando há valor estornado.',
        o: 'NOW() em sp_cancelar_pedido.', x: 'Prestação de contas e auditoria.' },
      { n: 'retorno_estoque', t: 'TINYINT(1)', c: ['NOT NULL', 'DEFAULT 0', 'CHECK ck_cancelamento_flags (0 ou 1)'], p: 'NA',
        d: 'Indica que os produtos de um pedido já entregue voltaram em condições de revenda; gera movimentação de Devolução por item (RN33).',
        o: 'Indicação do Gerente em sp_cancelar_pedido (vale apenas para pedido entregue).', x: 'movimentacao_estoque (tipo Devolução).' }
    ]
  },

  /* ================================================================== movimentacao_estoque */
  {
    nome: 'movimentacao_estoque',
    titulo: 'Movimentação de estoque',
    dominio: 'Estoque',
    finalidade: 'Extrato imutável do estoque: cada entrada, saída, devolução ou ajuste de um produto, com saldos anterior e posterior, data/hora e responsável (RF27 a RF29, RN31).',
    requisitos: 'RF13, RF14, RF27, RF28, RF29 | RN29 a RN34 | PR07 | RNF24, RNF25',
    retencao: '6 anos (RNF29). Imutável (trg_movimentacao_estoque_bu e trg_movimentacao_estoque_bd); correções por novo ajuste.',
    relacionamentos: 'movimentacao_estoque N:1 produto; N:1 usuario; N:0..1 pedido (obrigatório em Saída e Devolução)',
    objetos: 'trg_movimentacao_estoque_bi, trg_movimentacao_estoque_ai, trg_movimentacao_estoque_bu, trg_movimentacao_estoque_bd, sp_movimentar_estoque, vw_extrato_estoque, vw_validade_proxima, vw_conferencia_estoque',
    rbac: RBAC.estoque,
    colunas: [
      { n: 'id_movimentacao_estoque', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Identificador da movimentação; ordena o extrato e o saldo de abertura da conferência.',
        o: 'Gerado no INSERT.', x: 'vw_extrato_estoque, vw_conferencia_estoque.' },
      { n: 'id_produto', t: 'INT UNSIGNED', c: ['FK → produto.id_produto (fk_movimentacao_estoque_produto)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX idx_movimentacao_produto_data'], p: 'NA',
        d: 'Produto movimentado; a linha do produto é bloqueada (FOR UPDATE) durante o cálculo do saldo (RNF25).',
        o: 'sp_movimentar_estoque, trg_pedido_au, sp_cancelar_pedido.', x: 'produto.estoque_atual (trg_movimentacao_estoque_ai).' },
      { n: 'id_usuario', t: 'INT UNSIGNED', c: ['FK → usuario.id_usuario (fk_movimentacao_estoque_usuario)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX fk_movimentacao_estoque_usuario_idx'], p: 'DP',
        d: 'Responsável pela movimentação; nas saídas automáticas, o usuário da sessão ou o usuário técnico "sistema".',
        o: '@id_usuario_sessao ou fn_usuario_sessao().', x: 'vw_extrato_estoque (nome_usuario).' },
      { n: 'id_pedido', t: 'INT UNSIGNED', c: ['FK → pedido.id_pedido (fk_movimentacao_estoque_pedido)', 'NULL', 'ON DELETE RESTRICT', 'INDEX idx_movimentacao_pedido', 'CHECK ck_movimentacao_pedido'], p: 'NA',
        d: 'Pedido de origem: obrigatório em Saída e Devolução e proibido em Entrada e ajustes (RN32).',
        o: 'trg_pedido_au (Saída na entrega) e sp_cancelar_pedido (Devolução).', x: 'Rastreabilidade pedido x estoque; regra de expurgo (RNF29).' },
      { n: 'tipo_movimentacao', t: 'VARCHAR(20)', c: ['NOT NULL', 'CHECK ck_movimentacao_tipo (Entrada, Saída, Devolução, Ajuste Positivo, Ajuste Negativo)'], p: 'NA',
        d: 'Define se a quantidade soma (Entrada, Devolução, Ajuste Positivo) ou subtrai (Saída, Ajuste Negativo). Entrada e ajustes são manuais e restritos ao Gerente (RN34).',
        o: 'sp_movimentar_estoque (manual) ou gatilhos e procedimentos (automático).', x: 'Cálculo de saldo_posterior; vw_conferencia_estoque.' },
      { n: 'quantidade', t: 'INT', c: ['NOT NULL', 'CHECK ck_movimentacao_quantidade (maior que 0)'], p: 'NA',
        d: 'Quantidade sempre inteira e positiva; o sentido é dado pelo tipo (RN32).',
        o: 'Informada no registro ou copiada de item_pedido.quantidade.', x: 'Saldos e conferência do estoque.' },
      { n: 'saldo_anterior', t: 'INT', c: ['NOT NULL', 'CHECK ck_movimentacao_saldos (maior ou igual a 0)'], p: 'NA',
        d: 'Saldo do produto antes da movimentação. Redundância controlada do extrato imutável (seção 6.3).',
        o: 'produto.estoque_atual lido com bloqueio por trg_movimentacao_estoque_bi.', x: 'vw_extrato_estoque; saldo de abertura de vw_conferencia_estoque após expurgo.' },
      { n: 'saldo_posterior', t: 'INT', c: ['NOT NULL', 'CHECK ck_movimentacao_saldos (maior ou igual a 0)'], p: 'NA',
        d: 'Saldo após a movimentação; resultado negativo é rejeitado com "Estoque insuficiente" (RN29).',
        o: 'Calculado por trg_movimentacao_estoque_bi.', x: 'produto.estoque_atual (trg_movimentacao_estoque_ai), vw_extrato_estoque.' },
      { n: 'data_validade', t: 'DATE', c: ['NULL', 'CHECK ck_movimentacao_validade (somente em Entrada)'], p: 'NA',
        d: 'Validade da mercadoria recebida; permitida somente em Entrada, e entrada já vencida é rejeitada (PR07).',
        o: 'Registro de entrada de mercadorias (RF27).', x: 'vw_validade_proxima (vencidas ou com validade em até 7 dias).' },
      { n: 'motivo', t: 'VARCHAR(255)', c: ['NULL', 'CHECK ck_movimentacao_motivo_ajuste (obrigatório em ajustes)'], p: 'NA',
        d: 'Motivo ou origem da movimentação; obrigatório nos ajustes de inventário (RF28).',
        o: 'Informado pelo Gerente ou gerado ("Entrega do pedido n", "Cancelamento do pedido n").', x: 'vw_extrato_estoque.' },
      { n: 'data_hora', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP', 'INDEX idx_movimentacao_produto_data'], p: 'NA',
        d: 'Momento da movimentação, sempre gravado pelo servidor (trg_movimentacao_estoque_bi força NOW()).',
        o: 'Relógio do servidor MySQL.', x: 'Extrato cronológico (RF29), expurgo de 6 anos.' }
    ]
  },

  /* ================================================================== log_auditoria */
  {
    nome: 'log_auditoria',
    titulo: 'Trilha de auditoria',
    dominio: 'Segurança',
    finalidade: 'Trilha imutável das operações sensíveis: INSERT, UPDATE e DELETE nas tabelas de negócio e em usuario, exportações, anonimizações e logins, sem dado pessoal de cliente em claro (RF25, RNF03).',
    requisitos: 'RF12, RF18, RF23, RF25, RF26, RF30 | RN03, RN22 | PR01, PR04 | RNF03, RNF28, RNF29',
    retencao: '6 anos (RNF29). Imutável (trg_log_auditoria_bu e trg_log_auditoria_bd); remoção apenas pelo evento evt_expurgo_retencao.',
    relacionamentos: 'log_auditoria N:1 usuario (id_registro_afetado é referência lógica, sem chave estrangeira)',
    objetos: 'sp_registrar_auditoria, trg_log_auditoria_bu, trg_log_auditoria_bd, vw_log_auditoria, evt_expurgo_retencao',
    rbac: RBAC.log,
    colunas: [
      { n: 'id_log_auditoria', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Identificador sequencial do registro de auditoria.',
        o: 'Gerado no INSERT de sp_registrar_auditoria.', x: 'Consulta da trilha (RF25).' },
      { n: 'id_usuario', t: 'INT UNSIGNED', c: ['FK → usuario.id_usuario (fk_log_auditoria_usuario)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX fk_log_auditoria_usuario_idx'], p: 'DP',
        d: 'Usuário que executou a operação; sem sessão, o usuário técnico "sistema" (RN03).',
        o: 'fn_usuario_sessao().', x: 'Consulta por usuário (RF25).' },
      { n: 'tabela_afetada', t: 'VARCHAR(40)', c: ['NOT NULL', 'INDEX idx_log_tabela_registro'], p: 'NA',
        d: 'Tabela de negócio afetada; nas exportações, o nome do relatório; no expurgo, evt_expurgo_retencao.',
        o: 'Parâmetro dos gatilhos e procedimentos.', x: 'Consulta por tabela (RF25).' },
      { n: 'id_registro_afetado', t: 'INT UNSIGNED', c: ['NOT NULL', 'INDEX idx_log_tabela_registro'], p: 'NA',
        d: 'Chave do registro afetado na tabela indicada (referência lógica, sem FK); 0 em exportações e no expurgo.',
        o: 'NEW/OLD.id da tabela afetada.', x: 'Reconstrução do histórico de um registro.' },
      { n: 'operacao', t: 'VARCHAR(20)', c: ['NOT NULL', 'CHECK ck_log_auditoria_operacao (INSERT, UPDATE, DELETE, EXPORTACAO, ANONIMIZACAO, LOGIN, LOGIN_FALHA)'], p: 'NA',
        d: 'Tipo de operação auditada.',
        o: 'Gatilhos de auditoria e procedimentos.', x: 'Consulta por operação (RF25); falhas de login (RNF28); emissões da lista de devedores (PR04).' },
      { n: 'data_hora', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP', 'INDEX idx_log_data_hora'], p: 'NA',
        d: 'Momento da operação, gravado pelo servidor.',
        o: 'Relógio do servidor MySQL.', x: 'Consulta por período; expurgo de 6 anos.' },
      { n: 'valor_anterior', t: 'JSON', c: ['NULL'], p: 'DP',
        d: 'Estado anterior em JSON. Nomes de clientes, responsáveis e usuários, telefones e e-mails aparecem apenas como hash SHA-256 (RNF03). Exceção à 1FN documentada (seção 6.3).',
        o: 'Valores OLD montados com JSON_OBJECT nos gatilhos.', x: 'vw_log_auditoria (RF25).' },
      { n: 'valor_novo', t: 'JSON', c: ['NULL'], p: 'DP',
        d: 'Estado novo ou detalhes do evento em JSON (filtros da exportação, motivo da falha de login), com a mesma pseudonimização.',
        o: 'Valores NEW ou parâmetros dos procedimentos.', x: 'Consulta da trilha (RF25).' },
      { n: 'id_conexao', t: 'BIGINT UNSIGNED', c: ['NOT NULL'], p: 'NA',
        d: 'Identificador da conexão MySQL (CONNECTION_ID()), que vincula as operações à sessão aberta por sp_abrir_sessao.',
        o: 'CONNECTION_ID().', x: 'Correlação de eventos da mesma sessão.' }
    ]
  },

  /* ================================================================== solicitacao_titular */
  {
    nome: 'solicitacao_titular',
    titulo: 'Solicitação do titular (LGPD)',
    dominio: 'Privacidade',
    finalidade: 'Registro das solicitações dos titulares de dados pessoais (acesso, correção, portabilidade e anonimização) e do seu atendimento no prazo de 15 dias (RF26; LGPD, arts. 18 e 19).',
    requisitos: 'RF26 | PR03',
    retencao: '6 anos após o atendimento (RNF29): solicitações encerradas são removidas pelo evento evt_expurgo_retencao; as abertas nunca são expurgadas.',
    relacionamentos: 'solicitacao_titular N:1 cliente; solicitacao_titular N:0..1 usuario',
    objetos: 'trg_solicitacao_titular_bu, sp_registrar_solicitacao_titular, sp_atender_solicitacao_titular, sp_anonimizar_cliente, vw_solicitacoes_em_prazo',
    rbac: RBAC.titular,
    colunas: [
      { n: 'id_solicitacao_titular', t: 'INT UNSIGNED', c: ['PK', 'NOT NULL', 'AUTO_INCREMENT'], p: 'NA',
        d: 'Número de protocolo da solicitação.',
        o: 'Gerado no INSERT de sp_registrar_solicitacao_titular.', x: 'sp_atender_solicitacao_titular, sp_anonimizar_cliente.' },
      { n: 'id_cliente', t: 'INT UNSIGNED', c: ['FK → cliente.id_cliente (fk_solicitacao_titular_cliente)', 'NOT NULL', 'ON DELETE RESTRICT', 'INDEX fk_solicitacao_titular_cliente_idx'], p: 'DP',
        d: 'Titular que fez a solicitação; imutável (trg_solicitacao_titular_bu).',
        o: 'Atendimento ao titular (Administrador).', x: 'vw_solicitacoes_em_prazo, sp_exportar_dados_titular.' },
      { n: 'id_usuario', t: 'INT UNSIGNED', c: ['FK → usuario.id_usuario (fk_solicitacao_titular_usuario)', 'NULL', 'ON DELETE RESTRICT', 'INDEX fk_solicitacao_titular_usuario_idx', 'CHECK ck_solicitacao_atendimento'], p: 'DP',
        d: 'Administrador que atendeu ou recusou; NULL enquanto a solicitação está Aberta.',
        o: '@id_usuario_sessao no atendimento.', x: 'Responsabilização (RN03).' },
      { n: 'tipo_solicitacao', t: 'VARCHAR(20)', c: ['NOT NULL', 'CHECK ck_solicitacao_tipo (Acesso, Correção, Portabilidade, Anonimização)'], p: 'NA',
        d: 'Direito exercido pelo titular (LGPD, art. 18); imutável.',
        o: 'sp_registrar_solicitacao_titular.', x: 'vw_solicitacoes_em_prazo.' },
      { n: 'situacao', t: 'VARCHAR(10)', c: ['NOT NULL', "DEFAULT 'Aberta'", 'CHECK ck_solicitacao_situacao (Aberta, Atendida, Recusada)', 'CHECK ck_solicitacao_atendimento', 'INDEX idx_solicitacao_situacao'], p: 'NA',
        d: 'Situação do atendimento; solicitação encerrada não pode mais ser alterada.',
        o: 'sp_atender_solicitacao_titular ou sp_anonimizar_cliente.', x: 'vw_solicitacoes_em_prazo (somente Aberta).' },
      { n: 'data_solicitacao', t: 'DATETIME', c: ['NOT NULL', 'DEFAULT CURRENT_TIMESTAMP', 'INDEX idx_solicitacao_situacao'], p: 'NA',
        d: 'Momento da solicitação; inicia o prazo de 15 dias (LGPD, art. 19, II); imutável.',
        o: 'Relógio do servidor MySQL.', x: 'vw_solicitacoes_em_prazo (data_limite, dias_restantes, situacao_prazo).' },
      { n: 'data_atendimento', t: 'DATETIME', c: ['NULL', 'CHECK ck_solicitacao_datas (maior ou igual a data_solicitacao)', 'CHECK ck_solicitacao_atendimento'], p: 'NA',
        d: 'Momento do atendimento ou da recusa; obrigatório quando a solicitação é encerrada.',
        o: 'NOW() no atendimento.', x: 'Comprovação de cumprimento do prazo.' },
      { n: 'justificativa', t: 'VARCHAR(255)', c: ['NULL', 'CHECK ck_solicitacao_justificativa (obrigatória se Recusada)'], p: 'NA',
        d: 'Fundamento da recusa ou observação do atendimento.',
        o: 'Administrador em sp_atender_solicitacao_titular.', x: 'Resposta ao titular.' }
    ]
  }
];

/* -------------------------------------------------------------------------------------
   4. Utilitários
   ------------------------------------------------------------------------------------- */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const normalizar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Escapa o texto e permite quebra de linha após "_" em nomes longos (ex.: id_movimentacao_estoque)
const quebravel = (s) => esc(s).replace(/_/g, '_<wbr>');

function destacar(texto, termo) {
  if (!termo) return quebravel(texto);
  const i = normalizar(texto).indexOf(termo);
  if (i < 0) return quebravel(texto);
  return quebravel(texto.slice(0, i)) + '<mark>' + quebravel(texto.slice(i, i + termo.length)) + '</mark>' + quebravel(texto.slice(i + termo.length));
}

const BADGE = {
  DPS: { cls: 'badge-dps', txt: '[DPS]', title: 'Dado pessoal sensível (LGPD, art. 5º, II)' },
  DP:  { cls: 'badge-dp',  txt: '[DP]',  title: 'Dado pessoal (LGPD, art. 5º, I)' },
  NA:  { cls: 'badge-na',  txt: '[N/A]', title: 'Não aplicável: não identifica pessoa natural' }
};

function chipConstraint(c) {
  let tipo = 'chip';
  if (c === 'PK') tipo += ' chip-pk';
  else if (c.startsWith('FK')) tipo += ' chip-fk';
  else if (c.startsWith('UNIQUE')) tipo += ' chip-uk';
  else if (c === 'NOT NULL') tipo += ' chip-nn';
  else if (c === 'NULL') tipo += ' chip-null';
  else if (c.startsWith('CHECK')) tipo += ' chip-ck';
  return `<span class="${tipo}">[${esc(c)}]</span>`;
}

/* -------------------------------------------------------------------------------------
   5. Renderização
   ------------------------------------------------------------------------------------- */
function renderizarDicionario() {
  const alvo = document.getElementById('dicionario');
  const nav = document.getElementById('nav-tabelas');
  alvo.innerHTML = '';
  nav.innerHTML = '';

  TABELAS.forEach((tb, idx) => {
    const sec = document.createElement('section');
    sec.className = 'tabela-dic card';
    sec.id = 'tabela_' + tb.nome;
    sec.dataset.tabela = tb.nome;

    const linhas = tb.colunas.map((col) => {
      const b = BADGE[col.p];
      return `
        <tr data-coluna="${esc(col.n)}">
          <td data-label="Atributo" class="col-atributo"><code class="nome-col">${quebravel(col.n)}</code></td>
          <td data-label="Descrição / Regra de Negócio">${esc(col.d)}</td>
          <td data-label="Tipo e Tamanho"><code class="tipo">${esc(col.t)}</code></td>
          <td data-label="Constraints"><div class="chips">${col.c.map(chipConstraint).join('')}</div></td>
          <td data-label="Privacidade (LGPD)"><span class="badge ${b.cls}" title="${esc(b.title)}">${b.txt}</span></td>
          <td data-label="Linhagem"><div class="linhagem"><span><b>Origem:</b> ${esc(col.o)}</span><span><b>Destino:</b> ${esc(col.x)}</span></div></td>
          <td data-label="Controle de Acesso (RBAC)" class="col-rbac">${esc(col.a || tb.rbac)}</td>
        </tr>`;
    }).join('');

    const qtdDP = tb.colunas.filter((c) => c.p !== 'NA').length;

    sec.innerHTML = `
      <header class="tabela-cab">
        <div>
          <span class="tabela-num">Tabela ${String(idx + 1).padStart(2, '0')} | ${esc(tb.dominio)}</span>
          <h3><code class="nome-tabela">${esc(tb.nome)}</code><span class="tabela-titulo">${esc(tb.titulo)}</span></h3>
        </div>
        <div class="tabela-tags">
          <span class="tag">${tb.colunas.length} colunas</span>
          <span class="tag ${qtdDP ? 'tag-dp' : 'tag-na'}">${qtdDP} com dado pessoal</span>
        </div>
      </header>
      <p class="finalidade">${esc(tb.finalidade)}</p>
      <dl class="meta-tabela">
        <div><dt>Rastreabilidade</dt><dd>${esc(tb.requisitos)}</dd></div>
        <div><dt>Relacionamentos</dt><dd>${esc(tb.relacionamentos)}</dd></div>
        <div><dt>Retenção e ciclo de vida</dt><dd>${esc(tb.retencao)}</dd></div>
        <div><dt>Acesso (RBAC)</dt><dd>${esc(tb.rbac)}</dd></div>
        <div class="meta-larga"><dt>Objetos relacionados</dt><dd><code class="objetos">${esc(tb.objetos)}</code></dd></div>
      </dl>
      <div class="tabela-wrap">
        <table class="dic">
          <caption class="sr-only">Dicionário da tabela ${esc(tb.nome)}</caption>
          <thead>
            <tr>
              <th scope="col">Atributo</th>
              <th scope="col">Descrição / Regra de Negócio</th>
              <th scope="col">Tipo e Tamanho</th>
              <th scope="col">Constraints</th>
              <th scope="col">Privacidade (LGPD)</th>
              <th scope="col">Linhagem (Data Lineage)</th>
              <th scope="col">Controle de Acesso (RBAC)</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
    alvo.appendChild(sec);

    const li = document.createElement('li');
    li.dataset.tabela = tb.nome;
    li.innerHTML = `<a href="#tabela_${esc(tb.nome)}"><i class="fa-solid fa-table" aria-hidden="true"></i><span>${esc(tb.nome)}</span><small>${tb.colunas.length}</small></a>`;
    nav.appendChild(li);
  });

  // Indicadores do painel
  const totalCol = TABELAS.reduce((s, t) => s + t.colunas.length, 0);
  const totalFK = TABELAS.reduce((s, t) => s + t.colunas.filter((c) => c.c.some((x) => x.startsWith('FK'))).length, 0);
  const totalDP = TABELAS.reduce((s, t) => s + t.colunas.filter((c) => c.p === 'DP').length, 0);
  const totalDPS = TABELAS.reduce((s, t) => s + t.colunas.filter((c) => c.p === 'DPS').length, 0);
  document.getElementById('kpi-tabelas').textContent = TABELAS.length;
  document.getElementById('kpi-colunas').textContent = totalCol;
  document.getElementById('kpi-fk').textContent = totalFK;
  document.getElementById('kpi-dp').textContent = totalDP;
  document.getElementById('kpi-dps').textContent = totalDPS;
  document.getElementById('nav-total').textContent = TABELAS.length;
}

/* -------------------------------------------------------------------------------------
   6. Pesquisa em tempo real (nome da tabela ou da coluna)
   ------------------------------------------------------------------------------------- */
function configurarPesquisa() {
  const input = document.getElementById('busca');
  const info = document.getElementById('busca-info');
  const vazio = document.getElementById('sem-resultados');
  const limpar = document.getElementById('busca-limpar');

  const aplicar = () => {
    const termo = normalizar(input.value);
    let secoes = 0;
    let linhasVisiveis = 0;
    limpar.hidden = !termo;

    TABELAS.forEach((tb) => {
      const sec = document.getElementById('tabela_' + tb.nome);
      const itemNav = document.querySelector(`#nav-tabelas li[data-tabela="${tb.nome}"]`);
      const casaTabela = !termo || normalizar(tb.nome).includes(termo) || normalizar(tb.titulo).includes(termo);
      let visiveis = 0;

      sec.querySelectorAll('tbody tr').forEach((tr) => {
        const nome = tr.dataset.coluna;
        const casaColuna = termo && normalizar(nome).includes(termo);
        const mostrar = casaTabela || casaColuna;
        tr.hidden = !mostrar;
        tr.querySelector('.nome-col').innerHTML = destacar(nome, casaColuna ? termo : '');
        if (mostrar) visiveis += 1;
      });

      sec.querySelector('.nome-tabela').innerHTML = destacar(tb.nome, casaTabela && termo ? termo : '');
      const mostrarSec = visiveis > 0;
      sec.hidden = !mostrarSec;
      itemNav.hidden = !mostrarSec;
      if (mostrarSec) { secoes += 1; linhasVisiveis += visiveis; }
    });

    vazio.hidden = secoes > 0;
    info.textContent = termo
      ? `${secoes} tabela(s) e ${linhasVisiveis} coluna(s) encontradas para "${input.value.trim()}"`
      : 'Digite o nome de uma tabela ou coluna (ex.: telefone, pedido, data_).';
  };

  input.addEventListener('input', aplicar);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; aplicar(); } });
  limpar.addEventListener('click', () => { input.value = ''; aplicar(); input.focus(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !document.getElementById('modal-der').classList.contains('aberto')) {
      e.preventDefault(); input.focus();
    }
  });
  aplicar();
}

/* -------------------------------------------------------------------------------------
   7. Tema claro/escuro
   ------------------------------------------------------------------------------------- */
function configurarTema() {
  const raiz = document.documentElement;
  const botao = document.getElementById('tema-toggle');
  const atual = () => raiz.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const atualizarIcone = () => {
    const escuro = atual() === 'dark';
    botao.innerHTML = escuro
      ? '<i class="fa-solid fa-sun" aria-hidden="true"></i><span>Modo claro</span>'
      : '<i class="fa-solid fa-moon" aria-hidden="true"></i><span>Modo escuro</span>';
    botao.setAttribute('aria-pressed', String(escuro));
  };
  botao.addEventListener('click', () => {
    const novo = atual() === 'dark' ? 'light' : 'dark';
    raiz.dataset.theme = novo;
    try { localStorage.setItem('mlg-tema', novo); } catch (e) { /* armazenamento indisponível */ }
    atualizarIcone();
  });
  atualizarIcone();
}

/* -------------------------------------------------------------------------------------
   8. Sidebar responsiva e item ativo
   ------------------------------------------------------------------------------------- */
function configurarSidebar() {
  const body = document.body;
  const botao = document.getElementById('menu-toggle');
  const overlay = document.getElementById('overlay');
  const fechar = () => { body.classList.remove('menu-aberto'); botao.setAttribute('aria-expanded', 'false'); };
  botao.addEventListener('click', () => {
    const aberto = body.classList.toggle('menu-aberto');
    botao.setAttribute('aria-expanded', String(aberto));
  });
  overlay.addEventListener('click', fechar);
  document.getElementById('sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

  if ('IntersectionObserver' in window) {
    const links = document.querySelectorAll('#sidebar a[href^="#"]');
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === '#' + en.target.id));
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('main section[id]').forEach((s) => obs.observe(s));
  }
}

/* -------------------------------------------------------------------------------------
   9. Modal do DER com zoom e pan (Panzoom.js, com alternativa própria se a CDN falhar)
   ------------------------------------------------------------------------------------- */
function configurarModalDER() {
  const modal = document.getElementById('modal-der');
  const viewport = document.getElementById('der-viewport');
  const img = document.getElementById('der-img');
  const erro = document.getElementById('der-erro');
  const nivel = document.getElementById('der-nivel');
  let controle = null;
  let ultimoFoco = null;

  img.src = CONFIG.der;
  img.addEventListener('error', () => { erro.hidden = false; img.hidden = true; });

  const mostrarNivel = (escala) => { nivel.textContent = Math.round(escala * 100) + '%'; };

  function criarControle() {
    if (typeof window.Panzoom === 'function') {
      const pz = window.Panzoom(img, { maxScale: 12, minScale: 0.3, step: 0.3, canvas: true, cursor: 'grab' });
      viewport.addEventListener('wheel', pz.zoomWithWheel, { passive: false });
      img.addEventListener('panzoomchange', (e) => mostrarNivel(e.detail.scale));
      return {
        mais: () => pz.zoomIn(),
        menos: () => pz.zoomOut(),
        reset: () => { pz.reset(); mostrarNivel(1); }
      };
    }
    // Alternativa equivalente sem biblioteca
    let escala = 1, x = 0, y = 0, arrastando = false, inicioX = 0, inicioY = 0;
    const aplicar = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${escala})`; mostrarNivel(escala); };
    const zoom = (fator, cx, cy) => {
      const nova = Math.min(12, Math.max(0.3, escala * fator));
      const r = viewport.getBoundingClientRect();
      const px = (cx === undefined ? r.width / 2 : cx - r.left) - r.width / 2;
      const py = (cy === undefined ? r.height / 2 : cy - r.top) - r.height / 2;
      x = px - (px - x) * (nova / escala);
      y = py - (py - y) * (nova / escala);
      escala = nova;
      aplicar();
    };
    img.style.transformOrigin = 'center center';
    viewport.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    viewport.addEventListener('pointerdown', (e) => { arrastando = true; inicioX = e.clientX - x; inicioY = e.clientY - y; viewport.setPointerCapture(e.pointerId); viewport.classList.add('arrastando'); });
    viewport.addEventListener('pointermove', (e) => { if (!arrastando) return; x = e.clientX - inicioX; y = e.clientY - inicioY; aplicar(); });
    const soltar = () => { arrastando = false; viewport.classList.remove('arrastando'); };
    viewport.addEventListener('pointerup', soltar);
    viewport.addEventListener('pointercancel', soltar);
    return {
      mais: () => zoom(1.3),
      menos: () => zoom(1 / 1.3),
      reset: () => { escala = 1; x = 0; y = 0; aplicar(); }
    };
  }

  const abrir = () => {
    ultimoFoco = document.activeElement;
    modal.classList.add('aberto');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sem-rolagem');
    if (!controle) controle = criarControle();
    controle.reset();
    document.getElementById('der-fechar').focus();
  };
  const fechar = () => {
    modal.classList.remove('aberto');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sem-rolagem');
    if (ultimoFoco) ultimoFoco.focus();
  };

  document.getElementById('abrir-der').addEventListener('click', abrir);
  document.getElementById('der-fechar').addEventListener('click', fechar);
  document.getElementById('der-mais').addEventListener('click', () => controle && controle.mais());
  document.getElementById('der-menos').addEventListener('click', () => controle && controle.menos());
  document.getElementById('der-reset').addEventListener('click', () => controle && controle.reset());
  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('aberto')) return;
    if (e.key === 'Escape') fechar();
    if (e.key === '+' || e.key === '=') controle.mais();
    if (e.key === '-') controle.menos();
    if (e.key === '0') controle.reset();
  });
}

/* -------------------------------------------------------------------------------------
   10. Inicialização
   ------------------------------------------------------------------------------------- */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('link-pdf').setAttribute('href', CONFIG.pdf);
    renderizarDicionario();
    configurarPesquisa();
    configurarTema();
    configurarSidebar();
    configurarModalDER();
    document.getElementById('ano').textContent = new Date().getFullYear();
  });
} else if (typeof module !== 'undefined') {
  module.exports = { TABELAS };
}

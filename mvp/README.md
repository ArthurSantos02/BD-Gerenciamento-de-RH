# RH Conecta — MVP web

Aplicação demonstrável do portal colaborativo entre empresas clientes e escritórios contábeis. O MVP transforma admissões e férias em fluxos rastreáveis, com segregação multiempresa, competências, documentos e auditoria.

## Requisitos

- Node.js 24 ou superior. O projeto usa apenas módulos nativos e não exige `npm install`.

## Executar

```bash
npm start
```

Acesse `http://127.0.0.1:3000`. O banco SQLite é criado automaticamente em `data/rh-conecta.sqlite`.

Contas de demonstração, todas com a senha `Demo@123`:

| Perfil | E-mail |
|---|---|
| Responsável da empresa | `empresa@demo.rh` |
| Gestor aprovador | `gestor@demo.rh` |
| Analista de DP | `analista@demo.rh` |
| Administrador contábil | `admin@demo.rh` |
| Responsável de outra empresa | `oficina@demo.rh` |

## Testes

```bash
npm test
```

Os testes cobrem autenticação e CSRF, isolamento entre empresas (inclusive anexos), CPF, papéis do workflow, devolução com motivo, conclusão idempotente de admissão, férias concorrentes e competência fechada.

## Escopo implementado

- Login com sessão segura e perfis por organização.
- Proteção CSRF vinculada à sessão e limitação de tentativas de login.
- Seleção de empresa com autorização verificada no servidor.
- Dashboard com funcionários, competências, pendências e prazos.
- Cadastro e consulta de funcionários.
- Criação de competência, fechamento e reabertura auditados.
- Admissão e férias como movimentações com máquina de estados.
- Anexos PDF, PNG e JPEG de até 5 MB.
- Auditoria imutável.
- Exportação CSV por competência.
- Interface responsiva, sem framework externo.

## Arquitetura

```text
Navegador (HTML/CSS/JS)
        │ JSON/HTTPS
Servidor Node.js (node:http)
        ├── autenticação e autorização
        ├── regras e workflow
        ├── anexos locais
        └── SQLite (node:sqlite)
```

O SQLite reduz o atrito da demonstração. A camada de persistência deve ser adaptada para SQL Server antes de um piloto produtivo, preservando constraints, transações e isolamento por organização.

## Limites desta versão

- Não calcula folha nem transmite eventos ao eSocial.
- O envio de notificações é representado pela fila do portal; e-mail será integração posterior.
- Não substitui validação jurídica, contábil, LGPD ou teste de segurança independente.
- Anexos ficam no disco local; produção deve usar storage privado com antivírus e URLs temporárias.
- O primeiro administrador do piloto deve ser provisionado pelo operador; não existe cadastro público de administradores.

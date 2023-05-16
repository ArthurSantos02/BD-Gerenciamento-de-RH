# Banco de dados RH.

Esse projeto foi elaborado para a finalização do curso de **Administrador de Banco de Dados** - Senac DF.

Esse Banco de dados tem a finalidade do gerenciamento do setor de RH de uma empresa.

## Funcionalidades

* Armazenamento dos dados de funcionários.
* Controle dos registros de ponto dos funcionários.
* Controle dos departamentos.
* Controle de avaliações dos funcionários.
* Controle de dependentes.
* Controle de férias.
* Controle de atestados.
* Controle de benefício dos funcionários.
* Controle de impostos dos funcionários.
* Controle do histórico de cargo dos funcionários dentro da empresa.
* Controle de folhas de ponto.
* Controle de folhas de pagamento.

### Selects:

1. Consulta do codigo, beneficios e nome dos funcionário com respectivo cargo e salario, limitado apenas aos funcionários ativos. Em ordem alfabetica do nome.
2. Consulta o nome e salario dos funcionários que ganham mais de R$5.000,00 e possuem um dependente menor de idade.
3. Consulta do número de registros de ponto dos funcionário em um determinado ano.
4. Consultar o nome, CPF e salário dos funcionários cujo o nome comece com a letra C e possuem cargo com salário maior que R$2.000,00.
5. Consulta o nome, data de inicio e fim das ferias dos funcionarios que receberam pagamento maior que R$5.000,00.
6. Consulta todos os funcionários e suas pontuações na avaliação de desempenho dos funcionários ativos 
cujo a avaliação seja maior que três.
7. Selecionar valor total pago em beneficios no mês de janeiro de todos os funcionários menos o jovem aprendiz.
8. Selecionar todos os departamentos e cargos vinculados a cada departamento e, os funcionário de cada departamento.
9. Selecionar todos os beneficios não obrigatórios e quais os que estão sendo usados, retornando também o nome do funcionário.
10. Selecionar o funcionario com seu respectivo imposto da folha de pagamento referente ao mês de janeiro.

### Viwes:

1. Mostrar Nome, cargo, salario e código da folha de ponto e mês de referencia de todos os funcionários.
2. Mostrar nome e registros de ponto de um funcionario. 

### Funções:

1. Função que calcula o valor do desconto de IRRF do funcionário.
2. Função que calcula o desconto de INSS do funcionário em um determinado mês.
3. Função que calcula a média salárial dos pagamentos feitos aos funcionários em um determinado mês sem contar os beneficios ou impostos.
4. Função que Calcular o salário líquido de cada funcionário.

### Procedures:

1. Retorna a media salarial de um cargo que possui mais de um salário.
2. Consulta do codigo, nome, cargo, salario, apenas dos funcionários ativos em ordem alfabetica do nome e mostra seus beneficios referente ao mês de janeiro.

### Triggers:

1. Sempre que inserir uma folha de ponto será calculada o salário liquido e inserido na tabela folha de pagamento.
2. Sempre que inserir um novo funcionario, registra-se na tabela tb_historico_emprego um novo registro.
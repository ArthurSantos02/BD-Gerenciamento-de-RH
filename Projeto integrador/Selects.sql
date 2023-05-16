
USE rh;

-- SELECTS: 

-- 1. Consulta do codigo, nome, dos funcionário com respectivo cargo, salario, apenas dos funcionários ativos em ordem alfabetica do nome e mostra seus beneficios.
SELECT F.id_func, F.nome, C.nome AS Cargo 
FROM tb_funcionario AS F, tb_cargo AS C
WHERE F.id_cargo = C.id_cargo;

-- 2. Consulta o nome e salario dos funcionários que ganham mais de R$5.000,00 e possuem um dependentes menores de idade.
SELECT DISTINCT F.id_func, F.Nome, C.salario
FROM tb_funcionario AS f
LEFT JOIN tb_dependente d ON F.Id_Func = D.Id_Func
INNER JOIN tb_cargo AS C ON C.id_cargo = F.id_cargo
WHERE C.salario > 5000 AND DATEDIFF(YEAR, d.dt_nascimento, GETDATE()) < 18;

-- 3. Consulta do número de registros de ponto dos funcionário em um determinado ano.
SELECT F.nome AS Funcionario, YEAR(RP.dt_hora) AS Ano, COUNT(*) AS 'Numero de Registros'
FROM tb_funcionario AS F
INNER JOIN tb_registro_ponto AS RP ON F.id_func = RP.id_func
GROUP BY F.nome, YEAR(RP.dt_hora);

-- 4. Consultar o nome, CPF e salário dos funcionários cujo o nome comece com a letra C e possuem cargo com salário maior que R$2.000,00
SELECT F.nome, F.CPF, C.salario 
FROM Tb_Funcionario AS F 
INNER JOIN tb_cargo AS C ON F.id_cargo = C.id_cargo 
WHERE F.nome LIKE 'C%' AND C.salario > 2000 ;

-- 5. Selecionar o nome, data de inicio e fim das ferias dos funcionarios que receberam pagamento maior que R$5.000,00
SELECT F.nome AS Nome, CONVERT( VARCHAR, FR.dt_inicio, 103) AS 'Data de inicio',
CONVERT ( VARCHAR, FR.dt_fim, 103) AS 'Data de fim' 
FROM tb_funcionario AS F 
INNER JOIN tb_ferias AS FR ON F.id_func = FR.id_func 
WHERE FR.vl_pagamento > 5000;

-- 6. Selecionar todos os funcionários e suas pontuações na avaliação de desempenho dos funcionários ativos 
-- cujo a avaliação seja maior que três.
SELECT F.nome, A.estrelas
FROM tb_funcionario AS F
INNER JOIN tb_avaliacoes AS A ON F.id_func = A.id_func
WHERE A.estrelas >= '3';

-- 7. Selecionar valor total pago em beneficios no mês de janeiro de todos os funcionários menos o jovem aprendiz.
SELECT f.nome AS funcionario, SUM(bf.valor) AS 'Valor total', fp.mes AS	'Mês de referencia'
FROM tb_funcionario AS f
FULL  JOIN tb_folha_pagamento AS fp ON f.id_func = fp.id_func
INNER JOIN rl_benefunc AS bf ON f.id_func = bf.id_func
INNER JOIN tb_cargo AS c ON c.id_cargo = f.id_cargo
WHERE fp.mes = '1' AND c.nome != 'Jovem aprendiz'
GROUP BY f.nome, fp.mes;

-- 8. Selecionar todos os departamentos, cargos vinculados a cada departamento e os funcionário de cada departamento.
SELECT f.nome AS Funcionario, d.nome, c.nome FROM tb_departamento  AS d 
LEFT JOIN tb_funcionario AS f ON f.id_departamento = d.id_departamento
INNER JOIN  tb_cargo AS c ON c.id_cargo = f.id_cargo;


-- 9. Selecionar todos os beneficios não obrigatórios e quais os que estão sendo usados com  o nome do funcionário.
SELECT  b.nome, f.nome 
FROM tb_funcionario AS f
INNER JOIN  rl_benefunc AS bf ON f.id_func = bf.id_func
RIGHT JOIN tb_beneficio AS b ON b.id_beneficio = bf.id_beneficio
ORDER BY f.nome;

-- 10. Selecionar o funcionario com seu respectivo imposto da folha de pagamento referente ao mês de janeiro.
SELECT DISTINCT f.nome, STUFF((SELECT ', ' + i.nome
		FROM tb_imposto AS i
		INNER JOIN rl_imp_func AS fi ON i.id_imposto = fi.id_imposto
		WHERE fi.id_func = fp.id_func
		FOR XML PATH('')), 1, 2, '') AS Imposto 
FROM tb_funcionario AS f
INNER JOIN tb_folha_pagamento AS fp ON f.id_func = fp.id_func
INNER JOIN rl_Imp_func AS fi ON fi.id_func = fp.id_func
INNER JOIN tb_imposto AS i ON i.id_imposto = fi.id_imposto
WHERE fp.mes = '1';

-- VIWES: 
-- 1. Mostrar Nome, cargo, salario e código da folha de ponto e mês de referencia de todos os funcionários.
CREATE VIEW relacao_funcionarios AS
SELECT f.nome AS Funcionario, c.nome AS Cargo, c.salario AS Salario, 
fl.id_fl_pagamento AS 'Cod. folha de pagamento', 
fl.mes AS 'Mes de referencia'
FROM tb_funcionario f
INNER JOIN tb_cargo c ON c.id_cargo = f.id_cargo
INNER JOIN tb_folha_pagamento fl ON fl.id_func = f.id_func;

select * from relacao_funcionarios;

-- 2. Mostrar nome e registros de ponto de um funcionario. 
CREATE VIEW Registros_de_ponto AS
SELECT f.nome, 
CONCAT(r.tipo, ': ', CONVERT(varchar(10), r.dt_hora, 103), ' ', 
CONVERT(varchar(8), r.dt_hora, 108)) AS tipo_data_hora
FROM tb_funcionario f
INNER JOIN tb_cargo c ON c.id_cargo = f.id_cargo
INNER JOIN tb_registro_ponto r ON r.id_func = f.id_func;

select * from relacao_funcionarios;

-- Funções:
-- 1. função que calcula o valor do desconto de IRRF do funcionário.
CREATE FUNCTION calcularIRRF (@id_func INT, @mes INT)
RETURNS FLOAT 
AS
BEGIN
	DECLARE @salariobruto FLOAT
	DECLARE @porcentagem FLOAT
	DECLARE @valor_desconto FLOAT
	SELECT @salariobruto = salario FROM tb_cargo WHERE id_cargo 
		= (SELECT id_cargo FROM tb_funcionario WHERE id_func = @id_func)
	SELECT @porcentagem = i.porcentagem FROM tb_funcionario f 
		INNER JOIN rl_imp_func rl ON rl.id_func = f.id_func
		INNER JOIN tb_imposto i ON i.id_imposto = rl.id_imposto
		INNER JOIN tb_folha_ponto fp ON fp.id_func = f.id_func
		WHERE f.id_func = @id_func AND fp.mes = @mes AND i.nome = 'IRRF'
	SET @valor_desconto = @salariobruto * (@porcentagem / 100)
	RETURN @valor_desconto
END;

SELECT dbo.calcularIRRF (1,1);

-- 2. Função que calcula o desconto de INSS do funcionário em um determinado mês.
CREATE FUNCTION calcularINSS (@id_func INT, @mes INT)
RETURNS FLOAT 
AS
BEGIN
	DECLARE @salariobruto FLOAT
	DECLARE @porcentagem FLOAT
	DECLARE @valor_desconto FLOAT
	SELECT @salariobruto = salario FROM tb_cargo WHERE id_cargo 
		= (SELECT id_cargo FROM tb_funcionario WHERE id_func = @id_func)
	SELECT @porcentagem = i.porcentagem FROM tb_funcionario f 
		INNER JOIN rl_imp_func rl ON rl.id_func = f.id_func
		INNER JOIN tb_imposto i ON i.id_imposto = rl.id_imposto
		INNER JOIN tb_folha_ponto fp ON fp.id_func = f.id_func
		WHERE f.id_func = @id_func AND fp.mes = @mes AND i.nome = 'INSS'
	SET @valor_desconto = @salariobruto * (@porcentagem / 100)
	RETURN @valor_desconto
END;

DROP FUNCTION calcularIRRF;
select dbo.calcularINSS (1, 1) AS 'Valor a ser descontado na folha referenete ao IRRF';

-- 3. Função que calcula a média salárial dos pagamentos feitos aos funcionários em um determinado mês sem contar os beneficios ou impostos.
CREATE FUNCTION calcular_pagamentos_mes (@mes INT)
RETURNS FLOAT 
AS
BEGIN 
	DECLARE @media FLOAT
	DECLARE @total_func FLOAT
	DECLARE @total_pagamento FLOAT
	SELECT @total_pagamento = SUM(sl_liquido) FROM tb_folha_pagamento WHERE mes = @mes
	SELECT @total_func = COUNT (*) FROM tb_funcionario WHERE status_func = 'ativo'
	SET @media = @total_pagamento / @total_func
	RETURN @media
END;

SELECT dbo.calcular_pagamentos_mes (1) AS 'Media salarial dos funcionários';

-- 4. Calcular o salário líquido de cada funcionário.
CREATE FUNCTION salario_liquido (@id_func INT,  @mes INT)
RETURNS FLOAT
AS
BEGIN
	DECLARE @salario FLOAT
	DECLARE @impostos FLOAT
	DECLARE @salario_liquido FLOAT
	SELECT @salario = salario FROM tb_cargo WHERE id_cargo = (SELECT id_cargo FROM tb_funcionario WHERE id_func = @id_func)
	SELECT @impostos = (SELECT dbo.calcularIRRF (@id_func, @mes)) + (SELECT dbo.calcularINSS (@id_func, @mes))
	SET @salario_liquido = (@salario - @impostos)
	RETURN @salario_liquido
END;

SELECT dbo.salario_liquido (1, 1); AS 'Media salarial dos funcionários'

-- Procedures:
-- 1. Retorna a media salarial de um cargo que possui mais de um salário
CREATE PROCEDURE media_salario
AS 
BEGIN
	SELECT c.Nome, AVG(C.salario) AS Salario_Medio
	FROM Tb_Cargo AS c
	INNER JOIN Tb_Funcionario AS f ON c.Id_Cargo = f.Id_Cargo
	GROUP BY c.Nome
	HAVING COUNT(f.Id_Func) > 1
END;

EXECUTE media_salario;

-- 2. Consulta do codigo, nome, dos funcionário com respectivo cargo, salario, apenas dos funcionários ativos em ordem alfabetica do nome e mostra seus beneficioS referente ao mês de janeiro.
CREATE PROCEDURE visao_geral
AS
BEGIN
SELECT DISTINCT F.id_func AS Codigo, F.nome AS Funcionario,C.nome AS Cargo, d.nome AS Departamento,
		STUFF((SELECT ', ' + B.nome
		FROM tb_beneficio AS B
		INNER JOIN rl_benefunc AS R ON B.id_beneficio = R.id_beneficio
		WHERE R.id_func = F.id_func
		FOR XML PATH('')), 1, 2, '') AS Beneficio, 
		C.salario
FROM tb_funcionario AS F 
INNER JOIN tb_cargo AS C ON F.id_cargo = C.id_cargo
INNER JOIN rl_benefunc AS R ON R.id_func = F.id_func
INNER JOIN tb_departamento AS d On d.id_departamento = F.id_departamento
WHERE F.status_func = 'Ativo'
ORDER BY F.id_func
END;

EXECUTE visao_geral;

-- Triggers:
-- 1. Sempre que inserir uma folha de ponto será calculada o salário liquido e inserido na tabela folha de pagamento.
CREATE TRIGGER folha_de_pagamento
ON tb_folha_ponto
AFTER INSERT AS
	BEGIN
		DECLARE 
		@ano INT, 
		@mes INT, 
		@sl_liquido FLOAT, 
		@id_fl_ponto INT, 
		@id_func INT, 
		@id_cargo INT
		SELECT @ano = ano, @mes = mes, @id_fl_ponto = id_fl_ponto, @id_func = id_func FROM INSERTED
		SELECT @id_cargo =  f.id_cargo FROM tb_funcionario AS f WHERE f.id_func = @id_func
		SELECT @sl_liquido = dbo.salario_liquido (@id_func, @mes)
		INSERT INTO tb_folha_pagamento (ano, mes, sl_liquido, id_fl_ponto, id_func, id_cargo) 
		VALUES (@ano, @mes, @sl_liquido, @id_fl_ponto, @id_func, @id_cargo);
	END
GO

-- 2. Sempre que inserir um novo funcionario, registra-se na tabela tb_historico_emprego um novo registro.

CREATE TRIGGER horas_atestado
ON tb_funcionario
AFTER INSERT AS 
	BEGIN
		DECLARE
		@data_atual DATE,
		@id_cargo INT,
		@id_func INT
		SELECT @id_func = id_func, @id_cargo = id_cargo FROM INSERTED
		SELECT @data_atual = CONVERT (DATE, SYSDATETIME())
		INSERT INTO tb_hst_emprego (dt_inicio, id_func, id_cargo)
		VALUES (@data_atual, @id_func, @id_cargo);
	END
GO



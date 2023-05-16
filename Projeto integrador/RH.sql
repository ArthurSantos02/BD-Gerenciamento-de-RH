/*Criacao do banco*/
CREATE DATABASE rh
GO 

/*Selecao do Banco*/
USE rh
GO

/*Criação das tabelas*/
CREATE TABLE tb_beneficio(
	id_beneficio INT IDENTITY NOT NULL,
	tipo_beneficio VARCHAR(45) NOT NULL,
	nome VARCHAR(80) NOT NULL,
	PRIMARY KEY (id_beneficio)
	)
GO

CREATE TABLE tb_imposto(
	id_imposto INT IDENTITY NOT NULL,
	porcentagem DECIMAL NOT NULL,
	nome VARCHAR(80) NOT NULL
	PRIMARY KEY (id_imposto)
	)
GO

CREATE TABLE tb_cargo(
	id_cargo INT IDENTITY NOT NULL,
	nome VARCHAR(80) NOT NULL,
	salario FLOAT NOT NULL,
	PRIMARY KEY (id_cargo)
	)
GO

CREATE TABLE tb_departamento(
	id_departamento		INT IDENTITY	NOT NULL,
	nome				VARCHAR(80)		NOT NULL,
	PRIMARY KEY (id_departamento),
	)
GO

CREATE TABLE tb_funcionario(
	id_func			INT	IDENTITY			NOT NULL,
	nome			VARCHAR(15)				NOT NULL,
	sobrenome		VARCHAR(65)				NOT NULL,
	CPF				VARCHAR(11) UNIQUE		NOT NULL,
	dt_nasc			DATE					NOT NULL,
	tel_1			VARCHAR(11)				NOT NULL,
	tel_2			VARCHAR(11)				NOT NULL,
	tel_3			VARCHAR(11)				NULL,
	tel_4			VARCHAR(11)				NULL,
	email			VARCHAR(80)				NOT NULL,
	CEP				VARCHAR(8)				NOT NULL,
	logradouro		VARCHAR(150)			NOT NULL,
	cidade			VARCHAR(45)				NOT NULL,
	numero			VARCHAR(5)				NOT NULL,
	complemento		VARCHAR(150)			NULL,
	status_func		VARCHAR(30)				NOT NULL,
	dt_deslg		DATE					NULL,
	mtv_deslg		TEXT					NULL,
	id_cargo		INT						NOT NULL,
	id_departamento	INT						NOT NULL
	PRIMARY KEY (id_func),
	CONSTRAINT fk_cargo_funcionario FOREIGN KEY (id_cargo) REFERENCES tb_cargo (id_cargo),
	CONSTRAINT fk_departamento_funcionario FOREIGN KEY (id_departamento) REFERENCES tb_departamento (id_departamento)
	)
GO

CREATE TABLE tb_dependente(
	id_dependente	INT IDENTITY	NOT NULL,
	nome			VARCHAR(80)		NOT NULL,
	dt_nascimento	DATE			NOT NULL,
	parentesco		VARCHAR(45)		NOT NULL,
	id_func			INT				NOT NULL,
	PRIMARY KEY (id_dependente),
	CONSTRAINT fk_func_dependente  FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func)
	)
GO

CREATE TABLE tb_ferias(
	id_ferias		INT IDENTITY	NOT NULL,
	vl_pagamento	FLOAT			NOT NULL,
	dt_fim			DATE			NOT NULL,
	dt_inicio		DATE			NOT NULL,
	dt_pagamento	DATE			NOT NULL,
	id_func			INT				NOT NULL,
	PRIMARY KEY (id_ferias),
	CONSTRAINT fk_func_ferias FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func)
	)
GO

CREATE TABLE tb_atestado(
	id_atestado INT IDENTITY	NOT NULL,
	dt_inicio	DATE			NOT NULL,
	dt_fim		DATE			NOT NULL,
	motivo		TEXT			NOT NULL,
	observacao	VARCHAR(90)		NULL,
	id_func		INT				NOT NULL,
	PRIMARY KEY (id_atestado),
	CONSTRAINT fk_func_atestado FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func)
	)
GO

CREATE TABLE tb_avaliacoes(
	id_avaliacoes	INT IDENTITY	NOT NULL,
	dt_avaliacao	DATE			NOT NULL,
	observacoes		VARCHAR(200)	NOT NULL,
	estrelas		INT				NOT NULL,
	id_func			INT				NOT NULL,
	PRIMARY KEY (id_avaliacoes),
	CONSTRAINT fk_func_avaliacoes FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func)
	)
GO

CREATE TABLE tb_registro_ponto(
	id_reg_ponto	INT IDENTITY	NOT NULL,
	tipo			VARCHAR(40)		NOT NULL,
	dt_hora			DATETIME		NOT NULL,
	id_func			INT				NOT NULL,
	PRIMARY KEY (id_reg_ponto),
	CONSTRAINT fk_func_registro_ponto FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func)
	)
GO


CREATE TABLE tb_hst_emprego( 
	id_hst_emprego	INT	IDENTITY	NOT NULL,
	dt_fim			DATE			NULL,
	dt_inicio		DATE			NOT NULL,
	id_func			INT				NOT NULL,
	id_cargo		INT				NOT NULL,
	PRIMARY KEY (id_hst_emprego),
	CONSTRAINT fk_func_hst_emprego FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func),
	CONSTRAINT fk_argo_hst_emprego FOREIGN KEY (id_cargo) REFERENCES tb_cargo (id_cargo)
	)
GO

CREATE TABLE tb_folha_ponto(
	id_fl_ponto			INT IDENTITY	NOT NULL,
	mes					INT				NOT NULL,
	ano					INT				NOT NULL,
	tt_hrs_trabalhadas	TIME			NULL		DEFAULT ('00:00:00'),
	tt_hrs_faltas		TIME			NULL		DEFAULT ('00:00:00'),
	id_func				INT				NOT NULL,
	PRIMARY KEY (id_fl_ponto),
	CONSTRAINT fk_func_folha_ponto FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func)
  )
GO

CREATE TABLE tb_folha_pagamento(
  id_fl_pagamento	INT IDENTITY	NOT NULL,
  ano				INT				NOT NULL,
  mes				INT				NOT NULL,
  sl_liquido		FLOAT			NOT NULL,
  id_fl_ponto		INT				NOT NULL,
  id_func			INT				NOT NULL,
  id_cargo			INT				NOT NULL,
  PRIMARY KEY (id_fl_pagamento),
  CONSTRAINT fk_tb_folha_pagamento_tb_folha_ponto1 FOREIGN KEY (id_fl_ponto)REFERENCES tb_folha_ponto (id_fl_ponto),
  CONSTRAINT fk_id_func_tb_folha_pagamento FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func),
  CONSTRAINT fk_id_cargo_tb_folha_pagamento FOREIGN KEY (id_cargo) REFERENCES tb_cargo (id_cargo),
  )
GO

CREATE TABLE rl_benefunc(
	id_benefunc		INT IDENTITY	NOT NULL,
	id_beneficio	INT				NOT NULL,
	id_func			INT				NOT NULL,
	valor			FLOAT			NOT NULL,
	mes_ref			INT				NOT NULL,
	id_fl_pagamento INT				NOT NULL, 
	PRIMARY KEY (id_benefunc),
	CONSTRAINT fk_beneficio_rl_benefunc FOREIGN KEY (id_beneficio)REFERENCES tb_beneficio (id_beneficio), 
	CONSTRAINT fk_func_rl_benefunc FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func),
	CONSTRAINT fk_benefolhapagamento FOREIGN KEY (id_fl_pagamento) REFERENCES tb_folha_pagamento (id_fl_pagamento)
	)
GO

CREATE TABLE rl_Imp_func(
	id_Imp_func		INT IDENTITY	NOT NULL,
	id_func			INT				NOT NULL,
	id_imposto		INT				NOT NULL,
	PRIMARY KEY (id_Imp_func),
	CONSTRAINT fk_imposto_func FOREIGN KEY (id_func) REFERENCES tb_funcionario (id_func),
	CONSTRAINT fk_imposto_rl_Imp_func FOREIGN KEY (id_imposto)REFERENCES tb_imposto (id_imposto)
	)
GO
/*Fim*/

USE SIM;
DROP DATABASE rh;
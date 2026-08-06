ALTER TABLE guardians ADD COLUMN cpf TEXT;

CREATE UNIQUE INDEX idx_guardians_cpf ON guardians (cpf) WHERE cpf IS NOT NULL;

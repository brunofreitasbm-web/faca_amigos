-- Termos de Uso do Playground Inclusivo ainda não existiam de verdade — a
-- aba "Termos de Uso" do Gerencial (ConfiguracoesScreen > TermosTab) e a
-- tela pública de Acesso Rápido (AcessoRapidoScreen) já liam/exibiam
-- fa_kiosk_app_settings.terms_of_use, mas nenhuma unidade tinha esse
-- conteúdo cadastrado. Semeia o texto padrão em toda unidade que ainda
-- não tem um valor não-vazio — cada unidade continua livre para
-- editar/substituir pelo Gerencial depois.
insert into fa_kiosk_app_settings (unit_id, key, value, updated_at_ms)
select u.id, 'terms_of_use', $tos$TERMOS DE USO — FAÇA AMIGOS PLAYGROUND INCLUSIVO

Ao aceitar este termo, o responsável legal confirma que leu e concorda com as condições abaixo para a entrada da(s) criança(s) no espaço.

1. SOBRE O ESPAÇO
O Faça Amigos é um playground pensado para receber TODAS as crianças, incluindo crianças neurodivergentes (autismo, TDAH e outras condições sensoriais). Contamos com equipe orientada para cuidados inclusivos, mas não substituímos acompanhamento médico ou terapêutico.

2. RESPONSABILIDADE DO RESPONSÁVEL
A entrada da criança é sempre vinculada a um responsável legal presente na unidade durante toda a permanência, salvo unidades com serviço de recreação supervisionada contratado à parte. O responsável se compromete a: retirar a criança no horário contratado; permanecer localizável durante a visita; e informar à equipe qualquer necessidade especial, alergia ou condição de saúde relevante antes da entrada.

3. SAÚDE, ALERGIAS E CUIDADOS ESPECÍFICOS
É responsabilidade do responsável declarar alergias alimentares, uso de medicação contínua, crises previsíveis (ex.: convulsivas) ou qualquer condição que exija atenção da equipe. Informações marcadas como "criança neurodivergente" e as observações sensoriais registradas no cadastro são compartilhadas com a equipe do balcão para acolhimento adequado (abafadores, cantinho da calma, comunicação não-verbal, pausas sensoriais, entre outros).

4. USO DOS BRINQUEDOS E CONDUTA
As crianças devem seguir as orientações da equipe e a sinalização de idade/altura de cada brinquedo. Não é permitido uso de calçados dentro das áreas de brincar (uso de meias é obrigatório, conforme normas da unidade), alimentos e bebidas fora da praça de alimentação, nem comportamento que coloque em risco a própria criança ou terceiros.

5. IMAGEM
Fotos e vídeos podem ser feitos pela equipe para fins de segurança (identificação em caso de emergência) e, salvo objeção expressa do responsável junto à recepção, para divulgação do Faça Amigos em redes sociais e materiais promocionais. O responsável pode solicitar a qualquer momento a não utilização da imagem da criança em divulgação.

6. PAGAMENTO E DESCONTOS
Os valores exibidos consideram os descontos promocionais vigentes na unidade (ex.: promoção geral ou condição de meia-entrada para crianças neurodivergentes) e podem ser ajustados no balcão conforme a condição confirmada presencialmente. Alterações de plano, cancelamentos e reembolsos seguem a política vigente informada pela equipe da unidade.

7. PRIVACIDADE E DADOS PESSOAIS (LGPD)
Os dados aqui informados (nome da criança e do responsável, data de nascimento, CPF, telefone e observações de cuidado) são usados exclusivamente para identificação, segurança e atendimento durante a visita, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018). Não compartilhamos esses dados com terceiros para fins comerciais.

8. LIMITAÇÃO DE RESPONSABILIDADE
O Faça Amigos adota práticas de segurança nos equipamentos e na supervisão do espaço, mas não se responsabiliza por acidentes decorrentes do descumprimento das orientações de uso pelos responsáveis ou pelas crianças, nem por objetos pessoais deixados no espaço.

9. ACEITE
Ao marcar "Estou ciente e aceito", o responsável declara ter lido este termo, ter informado com veracidade os dados e condições de saúde da criança, e concorda com as condições de uso do Faça Amigos Playground Inclusivo.$tos$,
  (extract(epoch from now()) * 1000)::bigint
from fa_kiosk_units u
where not exists (
  select 1 from fa_kiosk_app_settings s
  where s.unit_id = u.id and s.key = 'terms_of_use' and coalesce(btrim(s.value), '') <> ''
)
on conflict (unit_id, key) do update set value = excluded.value, updated_at_ms = excluded.updated_at_ms;

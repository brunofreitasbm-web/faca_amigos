-- Reseed do pool de 1000 mensagens de aniversário (feedback do Owner):
-- as mensagens antigas repetiam o nome da criança até 3x (abertura + corpo
-- + fecho, já que os três blocos usavam {crianca}) e tinham cara de texto
-- gerado — muito emoji espalhado no meio das frases e tom de copy de
-- marketing ("cada criança tem seu próprio jeito de brincar...").
--
-- Reescritas do zero: {crianca} agora só existe nos 10 blocos de abertura,
-- então qualquer uma das 1000 combinações (10 abertura x 10 corpo x 10
-- fecho) menciona o nome da criança exatamente uma vez. Corpo e fecho
-- falam com o responsável em "vocês"/"essa turminha" para não precisar de
-- pronome com gênero (não existe esse dado cadastrado). Tom reescrito para
-- soar como mensagem de WhatsApp de uma pessoa de verdade, não texto
-- institucional.
truncate table fa_kiosk_birthday_messages;

insert into fa_kiosk_birthday_messages (message)
select trim(o) || ' ' || trim(b) || ' ' || trim(c)
from unnest(array[
  'Oi, {responsavel}! Hoje é aniversário de {crianca} e a gente não podia deixar passar em branco — {idade} aninhos! 🎂',
  '{responsavel}, bom dia! Passando aqui só pra dizer: hoje {crianca} completa {idade} aninhos e a gente tá na torcida por um dia lindo!',
  'Oi, {responsavel}! Sabia que hoje é dia de festa por aí? {crianca} faz {idade} anos e mereceu esse recadinho nosso. 💛',
  '{responsavel}, tudo bem? Hoje é um dia especial: {crianca} está completando {idade} aninhos! 🥳',
  'Bom dia, {responsavel}! A gente lembrou de vocês hoje: {crianca} faz {idade} anos e merece todo carinho do mundo.',
  'Oi, {responsavel}! Hoje tem bolo, vela e muita festa: {crianca} completa {idade} aninhos! 🧁',
  '{responsavel}, feliz aniversário pra {crianca}! Hoje são {idade} motivos pra sorrir.',
  'Oi, {responsavel}! Que alegria saber que hoje {crianca} está de aniversário novo, {idade} aninhos! ✨',
  '{responsavel}, passando rapidinho pra desejar um feliz aniversário: {crianca} completa {idade} anos hoje!',
  'Oi, {responsavel}! Hoje o dia é só alegria: {crianca} faz {idade} aninhos! 🌈'
]) as o
cross join unnest(array[
  'A gente aqui do Faça Amigos guarda um carinho enorme por essa família e fica muito feliz em fazer parte dessa trajetória.',
  'Cada visita de vocês por aqui deixa a gente mais feliz — o parque fica sempre mais bonito quando tem essa energia por perto.',
  'Ver essa turminha se divertindo do jeitinho dela é um dos momentos mais bonitos do nosso dia a dia aqui no parque.',
  'A gente torce muito por dias como esse, cheios de festa, carinho e aquela alegria gostosa de infância.',
  'Não é só mais um aniversário pra gente — é a alegria de acompanhar de perto uma fase tão especial da vida de vocês.',
  'Fica registrado aqui o nosso carinho: vocês fazem parte da família Faça Amigos e a gente sente isso todos os dias.',
  'A gente sabe o quanto esse dia é aguardado em casa, e é uma honra poder comemorar junto, mesmo que de longe.',
  'Cada sorriso que a gente vê por aqui vira combustível pra gente continuar cuidando desse espaço com tanto carinho.',
  'Esse tipo de data é um lembrete gostoso de por que a gente ama tanto o que faz aqui no parque.',
  'Fica aqui registrado nosso carinho e nossa torcida por muitos e muitos aninhos de saúde e alegria.'
]) as b
cross join unnest(array[
  'Esperamos vocês de volta em breve pra comemorar juntos aqui no parque! 🎠',
  'A porta do Faça Amigos está sempre aberta pra essa turminha vir brincar mais um pouco. 🧡',
  'Combinem a próxima visita quando quiserem — vai ser uma alegria enorme receber vocês de novo. 🌟',
  'Já fica o convite: tem muita brincadeira nova esperando por vocês aqui no parque. 🎡',
  'A gente já está com saudade e esperando a próxima visitinha! 💛',
  'Voltem sempre que quiserem — aqui sempre vai ter um lugar guardado pra essa festa continuar. 🎪',
  'Contamos com vocês pro próximo capítulo de diversão aqui no parque! 🎉',
  'Esperamos vocês em breve pra matar a saudade das risadas por aqui. 🎠',
  'Fica o convite carinhoso: voltem sempre que quiserem comemorar mais um pouco com a gente. 💚',
  'Já estamos na torcida pela próxima visita — venham quando quiserem! 🎈'
]) as c;

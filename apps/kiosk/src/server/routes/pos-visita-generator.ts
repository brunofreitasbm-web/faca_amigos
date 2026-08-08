export const INTROS = [
  "Olá {responsavel}! Tudo bem por aí? 😊 Nós do FaçaAmigos amamos cada segundo da visita do(a) {crianca} hoje!",
  "Oi {responsavel}! Como vocês estão? 💛 Foi uma alegria enorme receber o(a) {crianca} aqui com a gente hoje!",
  "Olá, {responsavel}! ✨ Que dia especial! O(A) {crianca} encheu nosso espaço de cor, gargalhadas e energia boa!",
  "Oi {responsavel}, tudo ótimo com vocês? 🌿 Ficamos radiantes com a presença do(a) {crianca} no nosso playground hoje!",
  "Olá {responsavel}! 🌟 Passando para mandar um abraço bem carinhoso e agradecer a visita do(a) {crianca}!",
  "Oi {responsavel}! 🎈 A equipe inteira do FaçaAmigos adorou passar esse tempinho especial com o(a) {crianca} hoje!",
  "Olá, {responsavel}! 🥰 Como foi o resto do dia de vocês? Ter o(a) {crianca} aqui com a gente é sempre um presente!",
  "Oi {responsavel}! 👋 Esperamos que o seu dia continue tão leve e especial quanto a brincadeira do(a) {crianca} hoje!",
  "Olá {responsavel}! 💖 Muito obrigado por nos confiar a alegria e o sorriso do(a) {crianca} hoje no FaçaAmigos!",
  "Oi {responsavel}! ✨ Que satisfação imensa ver o(a) {crianca} se divertindo tanto e explorando cada cantinho com a gente!",
];

export const TRANQUILITY_HOOKS = [
  "Sabemos como é importante ter um lugar seguro e calmo para deixar quem a gente mais ama relaxar e brincar em paz. 🛡️✨",
  "Nosso compromisso é sempre proporcionar esse ambiente acolhedor e protegido, onde você pode respirar fundo e ter total tranquilidade. 🌿🧘‍♀️",
  "Cuidar do bem-estar e da segurança do(a) {crianca} com todo o carinho do mundo é o que movimenta o nosso coração todos os dias! 🤍🧸",
  "Aqui no FaçaAmigos, cada detalhe é pensado para que a criança brinque livremente em um ambiente harmonioso, afetuoso e seguro. 🕊️✨",
  "Nada paga a paz de ver seu filho(a) sorrindo enquanto você sabe que ele(a) está sob os cuidados de uma equipe atenta e acolhedora! 🌸🛡️",
  "Queremos que você sempre sinta essa leveza no coração ao nos visitar: a certeza de um espaço calmo, seguro e repleto de amor. 🧸💚",
  "Nossa prioridade é ser aquele refúgio de paz no shopping, onde a diversão e a proteção andam sempre de mãos dadas. 🚀🛡️",
  "Ver o(a) {crianca} brincando tão à vontade nos dá a certeza de que cumprimos nossa missão de levar paz e acolhimento para a sua família! ☀️💛",
  "Você merece essa pausa tranquila sabendo que seu maior tesouro está sendo cuidado com paciência, carinho e responsabilidade. 🌿❤️",
  "Um ambiente inclusivo, calmo e seguro é o nosso presente para você e para o desenvolvimento feliz do(a) {crianca}. 🎈✨",
];

export const SUBLIMINAL_RETURN_HOOKS = [
  "Já estamos organizando os brinquedos favoritos do(a) {crianca} e contando os minutos para o nosso próximo reencontro! 🎠🍿",
  "O sorrisão do(a) {crianca} ficou gravado no nosso espaço, e os novos brinquedos já estão prontinhos te esperando em breve! 🎡🎁",
  "Ficamos com aquela saudade gostosa! A próxima aventura já está sendo preparada com muito carinho para vocês voltarem logo! 🎈🏰",
  "A energia de vocês contagia a gente! Já guardamos o cantinho preferido do(a) {crianca} para quando vocês voltarem essa semana! 🎨🎲",
  "Quem brinca com amor sempre deixa saudades! Esperamos reencontrar vocês muito em breve para mais momentos de pura leveza! 🌟🧸",
  "A sensação de alegria que o(a) {crianca} deixou aqui permanece! Já estamos ansiosos para ver esse sorriso de novo em breve! 🌈💛",
];

export const GOOGLE_REVIEW_CTAS = [
  "⭐ Poderia nos dar 5 estrelas no Google? Leva 10 segundos e você ganha 10% de DESCONTO no FaçaAmigos Circuito (válido por 7 dias)!\n👉 https://institutofacaamigos.com.br/playground/index.html?id={id_do_responsavel}",
  "🌟 Avalie nossa experiência com 5 estrelas no Google e garanta 10% OFF em qualquer plano do FaçaAmigos Circuito para curtir essa semana!\n👉 https://institutofacaamigos.com.br/playground/index.html?id={id_do_responsavel}",
  "⭐ Sua opinião vale ouro! Avalie com 5 estrelas no Google e receba 10% de DESCONTO automático na sua próxima visita no Circuito!\n👉 https://institutofacaamigos.com.br/playground/index.html?id={id_do_responsavel}",
  "✨ Conte para nós o que achou dando 5 estrelas no Google e ganhe 10% de DESCONTO especial no FaçaAmigos Circuito (válido por 7 dias)!\n👉 https://institutofacaamigos.com.br/playground/index.html?id={id_do_responsavel}",
  "⭐ Nos ajude com 5 estrelinhas no Google e liberamos 10% de DESCONTO no FaçaAmigos Circuito para a próxima brincadeira!\n👉 https://institutofacaamigos.com.br/playground/index.html?id={id_do_responsavel}",
];

/**
 * Gera uma mensagem combinada única a partir das listas modulares (10 x 10 x 6 x 5 = 3.000 combinações possíveis)
 */
export function generateRandomPosVisitaMessage(seed?: number): { id: string; title: string; message: string } {
  const s = seed !== undefined ? seed : Math.floor(Math.random() * 3000);
  
  const iIdx = s % INTROS.length;
  const tIdx = Math.floor(s / INTROS.length) % TRANQUILITY_HOOKS.length;
  const rIdx = Math.floor(s / (INTROS.length * TRANQUILITY_HOOKS.length)) % SUBLIMINAL_RETURN_HOOKS.length;
  const cIdx = Math.floor(s / (INTROS.length * TRANQUILITY_HOOKS.length * SUBLIMINAL_RETURN_HOOKS.length)) % GOOGLE_REVIEW_CTAS.length;

  const intro = INTROS[iIdx];
  const tranquility = TRANQUILITY_HOOKS[tIdx];
  const returnHook = SUBLIMINAL_RETURN_HOOKS[rIdx];
  const cta = GOOGLE_REVIEW_CTAS[cIdx];

  const fullMessage = `${intro}\n\n${tranquility}\n\n${returnHook}\n\n${cta}\n\nTe esperamos em breve! 💛🎈`;

  return {
    id: `comb_${s}`,
    title: `Variação FaçaAmigos #${s + 1}`,
    message: fullMessage,
  };
}

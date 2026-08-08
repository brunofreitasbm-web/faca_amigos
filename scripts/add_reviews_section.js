const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'LandingPage', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// CSS for Google Reviews section
const reviewsCss = `
/* ---------- Depoimentos / Avaliações Google ---------- */
.reviews-summary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: #FFF8D6;
  border: 1px solid rgba(255, 226, 52, 0.6);
  padding: 8px 18px;
  border-radius: 999px;
  font-weight: 700;
  color: var(--indigo);
  font-size: 0.95rem;
  margin-bottom: 24px;
}

.reviews-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
  margin-top: 40px;
}

.review-card {
  background: #fff;
  border-radius: 24px;
  padding: 32px 28px;
  box-shadow: var(--shadow-sm);
  border: 2px solid rgba(0, 45, 47, 0.06);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: var(--transition-bounce);
  position: relative;
}

.review-card:hover {
  transform: translateY(-8px);
  box-shadow: var(--shadow-lg);
  border-color: var(--sky);
}

.review-stars {
  color: #FFB800;
  font-size: 1.1rem;
  letter-spacing: 2px;
  margin-bottom: 14px;
}

.review-text {
  font-size: 1.02rem;
  color: var(--indigo);
  line-height: 1.6;
  margin-bottom: 24px;
  font-style: italic;
}

.review-author {
  display: flex;
  align-items: center;
  gap: 14px;
  border-top: 1px solid rgba(0, 45, 47, 0.08);
  padding-top: 16px;
}

.author-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--mint), var(--sun));
  color: var(--indigo);
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  font-family: 'Quicksand', sans-serif;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(0,0,0,0.08);
}

.author-info h4 {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 2px;
  font-family: 'Quicksand', sans-serif;
}

.author-info span {
  font-size: 0.82rem;
  color: var(--ink-soft);
  display: flex;
  align-items: center;
  gap: 4px;
}

.google-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #4285F4;
  font-weight: 600;
}

@media (max-width: 992px) {
  .reviews-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .reviews-grid {
    grid-template-columns: 1fr;
  }
}
`;

// Insert CSS if not present
if (!html.includes('.reviews-grid')) {
    html = html.replace('.bg-indigo { background: var(--indigo); color: #fff; }', '.bg-indigo { background: var(--indigo); color: #fff; }\n' + reviewsCss);
}

// HTML Section for Google Reviews
const reviewsHtmlSection = `
  <!-- DEPOIMENTOS E AVALIAÇÕES GOOGLE -->
  <section id="depoimentos" class="bg-aqua">
    <div class="wrap fade-in-up">
      <div class="text-center">
        <div class="reviews-summary">
          <span>⭐⭐⭐⭐⭐</span>
          <span>5.0 de 5.0 no Google Maps</span>
        </div>
        <h2 class="sec-title">O que dizem as famílias</h2>
        <p class="sec-sub">Confira as avaliações reais de mães, pais e responsáveis que vivem a experiência FaçaAmigos no Parque Shopping Belém.</p>
      </div>

      <div class="reviews-grid">
        <!-- Review 1 -->
        <div class="review-card">
          <div>
            <div class="review-stars">★★★★★</div>
            <p class="review-text">"Espaço maravilhoso e extremamente acolhedor! Pela primeira vez consegui fazer minhas compras no shopping com tranquilidade sabendo que meu filho atípico estava sendo cuidado por profissionais preparados com tanto carinho."</p>
          </div>
          <div class="review-author">
            <div class="author-avatar">MS</div>
            <div class="author-info">
              <h4>Mariana Silva</h4>
              <span>Mãe do Leo (5 anos) · <strong class="google-badge"><svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/></svg> Google</strong></span>
            </div>
          </div>
        </div>

        <!-- Review 2 -->
        <div class="review-card">
          <div>
            <div class="review-stars">★★★★★</div>
            <p class="review-text">"O FaçaAmigos Circuito foi uma surpresa incrível no shopping! Minha filha amou dirigir o carrinho elétrico e a equipe acompanha tudo de perto com muita atenção e segurança. Nota 10!"</p>
          </div>
          <div class="review-author">
            <div class="author-avatar">CE</div>
            <div class="author-info">
              <h4>Carlos Eduardo</h4>
              <span>Pai da Sofia (3 anos) · <strong class="google-badge"><svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/></svg> Google</strong></span>
            </div>
          </div>
        </div>

        <!-- Review 3 -->
        <div class="review-card">
          <div>
            <div class="review-stars">★★★★★</div>
            <p class="review-text">"Atendimento impecável e proposta de inclusão real. As monitoras têm um cuidado único com as crianças. Recomendamos de olhos fechados para todas as famílias de Belém!"</p>
          </div>
          <div class="review-author">
            <div class="author-avatar">PA</div>
            <div class="author-info">
              <h4>Patrícia Alencar</h4>
              <span>Mãe do Theo (7 anos) · <strong class="google-badge"><svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/></svg> Google</strong></span>
            </div>
          </div>
        </div>
      </div>

      <div class="text-center" style="margin-top: 40px;">
        <a href="https://g.page/r/CdAKkR4NdeqlEAE/review" target="_blank" rel="noopener" class="btn btn-outline">
          ⭐ Ver mais avaliações no Google
        </a>
      </div>
    </div>
  </section>
`;

// Insert the section before GALERIA DE FOTOS or FAQ
if (!html.includes('id="depoimentos"')) {
    const targetTag = '<!-- GALERIA DE FOTOS -->';
    if (html.includes(targetTag)) {
        html = html.replace(targetTag, reviewsHtmlSection + '\n  ' + targetTag);
    } else {
        html = html.replace('<section id="faq"', reviewsHtmlSection + '\n  <section id="faq"');
    }
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Successfully added Google Reviews section to LandingPage/index.html!');

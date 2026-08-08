const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'LandingPage', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// 1. Save base64 image to img/playground.jpg if found
const base64Start = html.indexOf('data:image/jpeg;base64,');
if (base64Start !== -1) {
    const base64End = html.indexOf('"', base64Start);
    const base64Str = html.substring(base64Start + 'data:image/jpeg;base64,'.length, base64End);
    const imgDir = path.join(__dirname, '..', 'LandingPage', 'img');
    if (!fs.existsSync(imgDir)) {
        fs.mkdirSync(imgDir, { recursive: true });
    }
    fs.writeFileSync(path.join(imgDir, 'playground.jpg'), Buffer.from(base64Str, 'base64'));
    console.log('Saved playground.jpg successfully!');
}

// 2. Add CSS styles
const cssToAdd = `
/* ---------- Visual Slides (Synced with Hero Carousel) ---------- */
.hero-visual {
  position: relative;
  min-height: 480px;
}

.hero-visual-slide {
  display: none;
  opacity: 0;
  transform: scale(0.96) translateY(10px);
  transition: opacity 0.5s ease, transform 0.5s ease;
  width: 100%;
}

.hero-visual-slide.active {
  display: block;
}

.hero-visual-slide.active.in {
  opacity: 1;
  transform: scale(1) translateY(0);
}

/* Dual Photo Composition for Circuito */
.hero-visual-dual {
  position: relative;
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  min-height: 460px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-visual-dual .card-main {
  position: relative;
  z-index: 2;
  width: 62%;
  aspect-ratio: 3/4;
  border-radius: 28px;
  overflow: hidden;
  border: 6px solid #fff;
  box-shadow: var(--shadow-float);
  transform: rotate(-3deg);
  transition: var(--transition-bounce);
  background: #fff;
}

.hero-visual-dual .card-main:hover {
  transform: rotate(0deg) scale(1.03);
  z-index: 4;
}

.hero-visual-dual .card-main img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-visual-dual .card-sub {
  position: absolute;
  right: 0;
  bottom: 10px;
  z-index: 3;
  width: 58%;
  aspect-ratio: 3/4;
  border-radius: 28px;
  overflow: hidden;
  border: 6px solid #fff;
  box-shadow: var(--shadow-lg);
  transform: rotate(4deg);
  transition: var(--transition-bounce);
  background: #fff;
}

.hero-visual-dual .card-sub:hover {
  transform: rotate(0deg) scale(1.03);
  z-index: 4;
}

.hero-visual-dual .card-sub img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-badge {
  position: absolute;
  bottom: 12px;
  left: 12px;
  right: 12px;
  background: rgba(0, 45, 47, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #fff;
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 0.78rem;
  font-weight: 700;
  text-align: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  letter-spacing: -0.01em;
}

.card-badge.badge-coral {
  background: rgba(245, 4, 105, 0.9);
}

.card-badge.badge-sun {
  background: rgba(0, 45, 47, 0.9);
  color: var(--sun);
}
`;

if (!html.includes('hero-visual-slide')) {
    html = html.replace('.photo-blob img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}', '.photo-blob img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n' + cssToAdd);
}

// 3. Replace hero-visual content with dual visual slides
const heroVisualRegex = /<div class="hero-visual fade-in-up" style="transition-delay: 0\.2s;">[\s\S]*?<\/div>\s*<\/div>\s*<\/header>/;

const newHeroVisualHtml = `<div class="hero-visual fade-in-up" style="transition-delay: 0.2s;">
        <!-- Slide 0 Visual: Playground Inclusivo -->
        <div class="hero-visual-slide active in" data-visual="0">
          <div class="photo-blob">
            <img src="img/playground.jpg" alt="Playground Inclusivo FaçaAmigos no Parque Shopping Belém">
          </div>
        </div>

        <!-- Slide 1 Visual: FaçaAmigos Circuito (Composição Harmônica com 2 Fotos) -->
        <div class="hero-visual-slide" data-visual="1">
          <div class="hero-visual-dual">
            <!-- Foto 1: Totem/Quiosque com Tela Infantil -->
            <div class="card-main">
              <img src="img/circuito_totem.jpg" alt="Quiosque FaçaAmigos Circuito no Parque Shopping Belém">
              <div class="card-badge badge-sun">🏎️ Quiosque Interativo</div>
            </div>
            <!-- Foto 2: Equipe Monitora e Carrinhos Elétricos -->
            <div class="card-sub">
              <img src="img/circuito_equipe.jpg" alt="Equipe especializada e carrinhos elétricos do FaçaAmigos Circuito">
              <div class="card-badge badge-coral">✨ Equipe Especializada</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </header>`;

html = html.replace(heroVisualRegex, newHeroVisualHtml);

// 4. Update JS carousel code to sync visual slides
const oldGoToSlideJS = `      if (index === activeIndex) return;
      const current = slides[activeIndex];
      const next = slides[index];

      current.classList.remove('in');

      const swap = () => {
        current.classList.remove('active');
        next.classList.add('active');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => next.classList.add('in'));
        });
      };`;

const newGoToSlideJS = `      if (index === activeIndex) return;
      const current = slides[activeIndex];
      const next = slides[index];

      const visualSlides = document.querySelectorAll('.hero-visual-slide');
      const currentVisual = document.querySelector(\`.hero-visual-slide[data-visual="\${activeIndex}"]\`);
      const nextVisual = document.querySelector(\`.hero-visual-slide[data-visual="\${index}"]\`);

      current.classList.remove('in');
      if (currentVisual) currentVisual.classList.remove('in');

      const swap = () => {
        current.classList.remove('active');
        next.classList.add('active');

        visualSlides.forEach(v => v.classList.remove('active', 'in'));
        if (nextVisual) {
          nextVisual.classList.add('active');
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            next.classList.add('in');
            if (nextVisual) nextVisual.classList.add('in');
          });
        });
      };`;

html = html.replace(oldGoToSlideJS, newGoToSlideJS);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Successfully updated LandingPage/index.html with dual photo carousel!');

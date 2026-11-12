const games = Array.from({ length: 18 }, (_, index) => ({
  title: index === 0 ? 'Cookie Clicker' : 'Placeholder Game',
  url: index === 0 ? 'js/index.html' : null,
  slot: index + 1,
}));
const featuredGames = games.slice(0, 7);

const track = document.querySelector('#featured-track');
const grid = document.querySelector('#game-grid');
const dots = document.querySelector('#carousel-dots');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const slideCount = document.querySelector('#slide-count');
const dialog = document.querySelector('#game-dialog');
const cardTemplate = document.querySelector('#card-template');

function createCard(game, featured) {
  const card = document.createElement(game.url ? 'a' : 'button');
  card.className = featured ? 'game-card featured-card' : 'game-card';
  card.append(cardTemplate.content.cloneNode(true));
  card.querySelector('.card-title').textContent = game.title;
  if (featured) {
    card.querySelector('.action-label').textContent = game.url ? 'Play now' : 'View game';
  }

  if (game.url) {
    card.href = game.url;
    card.setAttribute('aria-label', `Play ${game.title}`);
  } else {
    card.type = 'button';
    card.setAttribute('aria-label', `${game.title} ${game.slot}`);
    card.addEventListener('click', () => dialog.showModal());
  }

  return card;
}

const slides = featuredGames.map((game) => createCard(game, true));
const indicators = featuredGames.map((game, index) => {
  const indicator = document.createElement('button');
  indicator.type = 'button';
  indicator.className = 'carousel-dot';
  indicator.setAttribute('aria-label', `Featured game ${index + 1}: ${game.title}`);
  indicator.setAttribute('aria-controls', track.id);
  indicator.addEventListener('click', () => goToSlide(index));
  return indicator;
});

track.append(...slides);
dots.append(...indicators);
grid.append(...games.map((game) => createCard(game, false)));

let activeIndex = 0;
let requestedIndex = null;
let scrollTimer;

function updateControls(index) {
  activeIndex = index;
  previous.setAttribute('aria-disabled', String(index === 0));
  next.setAttribute('aria-disabled', String(index === slides.length - 1));
  const current = String(index + 1).padStart(2, '0');
  const total = String(slides.length).padStart(2, '0');
  slideCount.textContent = `${current} / ${total}`;
  indicators.forEach((indicator, position) => {
    indicator.setAttribute('aria-current', String(index === position));
  });
}

function goToSlide(index) {
  const target = Math.max(0, Math.min(index, slides.length - 1));
  const left = slides[target].offsetLeft;
  if (Math.abs(track.scrollLeft - left) < 1) {
    requestedIndex = null;
    return;
  }
  requestedIndex = target;
  track.scrollTo({ left });
}

function step(direction) {
  goToSlide((requestedIndex ?? activeIndex) + direction);
}

track.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const nearest = slides.reduce((closest, slide, index) => {
      return Math.abs(slide.offsetLeft - track.scrollLeft) < Math.abs(slides[closest].offsetLeft - track.scrollLeft)
        ? index
        : closest;
    }, 0);
    requestedIndex = null;
    if (nearest !== activeIndex) updateControls(nearest);
  }, 80);
}, { passive: true });

previous.addEventListener('click', () => step(-1));
next.addEventListener('click', () => step(1));
track.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  step(event.key === 'ArrowLeft' ? -1 : 1);
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

updateControls(0);

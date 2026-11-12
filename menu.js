const games = Array.from({ length: 18 }, (_, index) => ({
  title: index === 0 ? 'Cookie Clicker' : 'Placeholder Game',
  url: index === 0 ? 'js/index.html' : null,
  slot: index + 1,
}));
const featuredGames = games.slice(0, 7);

const carousel = document.querySelector('#featured-carousel');
const track = document.querySelector('#featured-track');
const grid = document.querySelector('#game-grid');
const dots = document.querySelector('#carousel-dots');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const slideCount = document.querySelector('#slide-count');
const dialog = document.querySelector('#game-dialog');
const cardTemplate = document.querySelector('#card-template');
const featuredTemplate = document.querySelector('#featured-template');

function createGameControl(game) {
  const control = document.createElement(game.url ? 'a' : 'button');
  if (game.url) {
    control.href = game.url;
    control.setAttribute('aria-label', `Play ${game.title}`);
  } else {
    control.type = 'button';
    control.setAttribute('aria-label', `${game.title} ${game.slot}`);
    control.addEventListener('click', () => dialog.showModal());
  }
  return control;
}

function createCard(game) {
  const card = createGameControl(game);
  card.className = 'game-card';
  card.append(cardTemplate.content.cloneNode(true));
  card.querySelector('.card-title').textContent = game.title;
  return card;
}

const slides = featuredGames.map((game, index) => {
  const slide = featuredTemplate.content.firstElementChild.cloneNode(true);
  slide.setAttribute('aria-label', `${index + 1} of ${featuredGames.length}`);
  slide.querySelector('.featured-title').textContent = game.title;

  const play = createGameControl(game);
  play.className = 'featured-play';
  play.setAttribute('aria-label', game.url ? `Play ${game.title}` : `Play ${game.title} ${game.slot}`);
  const icon = document.createElement('span');
  icon.className = 'play-icon';
  icon.setAttribute('aria-hidden', 'true');
  play.append(icon, game.url ? 'Play now' : 'Play');
  slide.querySelector('.featured-copy').append(play);
  return slide;
});
const playControls = slides.map((slide) => slide.querySelector('.featured-play'));
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
grid.append(...games.map(createCard));

let activeIndex = 0;
let requestedIndex = null;
let scrollTimer;
let wheelTimer;
let wheelDirection = 0;

function updateControls(index) {
  if (playControls[activeIndex] === document.activeElement && index !== activeIndex) {
    track.focus({ preventScroll: true });
  }
  activeIndex = index;
  previous.setAttribute('aria-disabled', String(index === 0));
  next.setAttribute('aria-disabled', String(index === slides.length - 1));
  const current = String(index + 1).padStart(2, '0');
  const total = String(slides.length).padStart(2, '0');
  slideCount.textContent = `${current} / ${total}`;
  indicators.forEach((indicator, position) => {
    indicator.setAttribute('aria-current', String(index === position));
    playControls[position].tabIndex = index === position ? 0 : -1;
  });
}

function goToSlide(index) {
  const target = Math.max(0, Math.min(index, slides.length - 1));
  const left = slides[target].offsetLeft;
  if (Math.abs(track.scrollLeft - left) < 1) {
    if (requestedIndex !== null) track.scrollTo({ left, behavior: 'instant' });
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
carousel.addEventListener('click', (event) => {
  if (event.target.closest('a, button')) return;
  const index = requestedIndex ?? activeIndex;
  goToSlide((index + 1) % slides.length);
});

carousel.addEventListener('wheel', (event) => {
  if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

  const direction = Math.sign(event.deltaY);
  const destination = (requestedIndex ?? activeIndex) + direction;
  const sameGesture = direction === wheelDirection;
  if (!sameGesture && (destination < 0 || destination >= slides.length)) return;

  event.preventDefault();
  if (!sameGesture) step(direction);
  wheelDirection = direction;
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { wheelDirection = 0; }, 150);
}, { passive: false });

track.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  step(event.key === 'ArrowLeft' ? -1 : 1);
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

updateControls(0);

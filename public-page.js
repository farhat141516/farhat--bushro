function makeTeacherCard(teacher, icon) {
  const article = document.createElement('article');
  article.className = 'teacher-card';
  const iconElement = document.createElement('span');
  iconElement.className = 'teacher-icon';
  iconElement.setAttribute('aria-hidden', 'true');
  iconElement.textContent = icon;
  const content = document.createElement('div');
  const name = document.createElement('h3');
  name.textContent = teacher.name;
  const subject = document.createElement('p');
  subject.textContent = teacher.subject;
  content.append(name, subject);
  article.append(iconElement, content);
  return article;
}

function makePhotoCarousel(container, photos) {
  container.replaceChildren();
  container.classList.toggle('has-photos', photos.length > 0);
  const photoSlot = container.closest('.madrasa-photo-slot');
  photoSlot?.classList.toggle('has-photos', photos.length > 0);
  photoSlot?.classList.toggle('image-unavailable', photos.length === 0);
  container.setAttribute('role', 'region');
  container.setAttribute('aria-roledescription', 'карусель фотографий');
  container.setAttribute('aria-label', 'Фотографии медресе');
  if (!photos.length) return;

  container.tabIndex = 0;
  const slides = photos.map((source, index) => {
    const slide = document.createElement('div');
    slide.className = 'photo-carousel__slide';
    slide.hidden = index !== 0;
    const image = document.createElement('img');
    image.alt = `Фотография медресе, ${index + 1} из ${photos.length}`;
    image.draggable = false;
    image.addEventListener('load', () => {
      const aboutGallery = container.closest('.about-gallery');
      if (!aboutGallery) return;
      aboutGallery.classList.toggle('is-portrait', image.naturalHeight > image.naturalWidth);
      aboutGallery.classList.toggle('is-landscape', image.naturalWidth >= image.naturalHeight);
    });
    image.src = source;
    slide.append(image);
    container.append(slide);
    return slide;
  });

  if (photos.length < 2) return;
  let activeIndex = 0;
  const controls = document.createElement('div');
  controls.className = 'photo-carousel__controls';
  const previous = document.createElement('button');
  previous.className = 'photo-carousel__arrow photo-carousel__arrow--previous';
  previous.type = 'button';
  previous.setAttribute('aria-label', 'Предыдущее фото');
  previous.textContent = '‹';
  const next = document.createElement('button');
  next.className = 'photo-carousel__arrow photo-carousel__arrow--next';
  next.type = 'button';
  next.setAttribute('aria-label', 'Следующее фото');
  next.textContent = '›';
  const indicators = document.createElement('div');
  indicators.className = 'photo-carousel__indicators';
  indicators.setAttribute('aria-label', 'Выбрать фотографию');
  const counter = document.createElement('span');
  counter.className = 'photo-carousel__counter';
  counter.setAttribute('aria-live', 'polite');
  const dots = photos.map((_, index) => {
    const dot = document.createElement('button');
    dot.className = 'photo-carousel__dot';
    dot.type = 'button';
    dot.setAttribute('aria-label', `Фото ${index + 1}`);
    dot.addEventListener('click', () => show(index));
    indicators.append(dot);
    return dot;
  });
  controls.append(previous, indicators, next, counter);
  container.append(controls);

  function show(index) {
    activeIndex = (index + photos.length) % photos.length;
    slides.forEach((slide, slideIndex) => { slide.hidden = slideIndex !== activeIndex; });
    dots.forEach((dot, dotIndex) => {
      dot.classList.toggle('is-active', dotIndex === activeIndex);
      dot.setAttribute('aria-current', String(dotIndex === activeIndex));
    });
    counter.textContent = `${activeIndex + 1} / ${photos.length}`;
  }

  previous.addEventListener('click', () => show(activeIndex - 1));
  next.addEventListener('click', () => show(activeIndex + 1));
  container.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(activeIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(activeIndex + 1); }
  });
  let pointerStart = null;
  container.addEventListener('pointerdown', (event) => { pointerStart = event.clientX; });
  container.addEventListener('pointerup', (event) => {
    if (pointerStart === null) return;
    const distance = event.clientX - pointerStart;
    pointerStart = null;
    if (Math.abs(distance) > 45) show(activeIndex + (distance < 0 ? 1 : -1));
  });
  container.addEventListener('pointercancel', () => { pointerStart = null; });
  show(0);
}

fetch('/api/content').then((response) => response.json()).then((content) => {
  Object.entries(content.icons || {}).forEach(([name, value]) => document.querySelector(`[data-icon="${name}"]`)?.replaceChildren(document.createTextNode(value)));
  document.querySelectorAll('.madrasa-gallery').forEach((gallery) => makePhotoCarousel(gallery, content.photos || []));
  const empty = document.querySelector('#about-empty');
  if (empty) empty.hidden = Boolean(content.photos?.length);
  const homeTeachers = document.querySelector('#public-home-teachers');
  if (homeTeachers) {
    const teachers = [...(content.teachers?.hafiz || []), ...(content.teachers?.alim || [])].slice(0, 3);
    homeTeachers.replaceChildren(...teachers.map((teacher) => makeTeacherCard(teacher, '♙')));
  }
  ['hafiz', 'alim'].forEach((group) => { const target = document.querySelector(`#public-${group}-teachers`); if (target) { target.replaceChildren(...(content.teachers?.[group] || []).map((teacher) => makeTeacherCard(teacher, content.icons?.[group] || '♙'))); } });
}).catch(() => {});

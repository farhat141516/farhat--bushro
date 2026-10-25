const form = document.querySelector('#application-form');
const status = document.querySelector('#form-status');
const requiredFields = form ? [...form.querySelectorAll('[required]')] : [];

const birthDateInput = document.querySelector('#birth-date');
const birthDateDialog = document.querySelector('#birth-date-dialog');

if (birthDateInput && birthDateDialog) {
  const dayWheel = document.querySelector('#birth-day-wheel');
  const monthWheel = document.querySelector('#birth-month-wheel');
  const yearWheel = document.querySelector('#birth-year-wheel');
  const preview = document.querySelector('#birth-date-preview');
  const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const currentYear = new Date().getFullYear();
  const dateState = { day: 1, month: 1, year: currentYear - 10 };
  const wheels = [[dayWheel, 'day'], [monthWheel, 'month'], [yearWheel, 'year']];
  const scrollTimers = new WeakMap();
  let updatingWheel = false;

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function dateOptions(part) {
    if (part === 'day') return Array.from({ length: daysInMonth(dateState.year, dateState.month) }, (_, index) => [index + 1, String(index + 1)]);
    if (part === 'month') return months.map((month, index) => [index + 1, month]);
    return Array.from({ length: currentYear - 1899 }, (_, index) => [currentYear - index, String(currentYear - index)]);
  }

  function setWheel(wheel, part) {
    const options = dateOptions(part);
    wheel.replaceChildren(...options.map(([value, label]) => {
      const option = document.createElement('button');
      option.className = 'date-wheel__option';
      option.type = 'button';
      option.dataset.value = String(value);
      option.setAttribute('role', 'option');
      option.textContent = label;
      return option;
    }));
    const selectedIndex = options.findIndex(([value]) => value === dateState[part]);
    wheel.dataset.part = part;
    wheel.dataset.updating = 'true';
    updateWheelSelection(wheel, part, options[Math.max(0, selectedIndex)]?.[0]);
    requestAnimationFrame(() => {
      wheel.scrollTop = Math.max(0, selectedIndex) * 44;
      requestAnimationFrame(() => { wheel.dataset.updating = 'false'; });
    });
  }

  function updateWheelSelection(wheel, part, value) {
    wheel.querySelectorAll('.date-wheel__option').forEach((option) => {
      const selected = Number(option.dataset.value) === value;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-selected', String(selected));
    });
    dateState[part] = value;
    preview.textContent = `${String(dateState.day).padStart(2, '0')} ${months[dateState.month - 1]} ${dateState.year}`;
  }

  function updateDatePart(part, value) {
    dateState[part] = value;
    dateState.day = Math.min(dateState.day, daysInMonth(dateState.year, dateState.month));
    if (part !== 'day') setWheel(dayWheel, 'day');
    for (const [wheel, wheelPart] of wheels) updateWheelSelection(wheel, wheelPart, dateState[wheelPart]);
  }

  for (const [wheel, part] of wheels) {
    wheel.addEventListener('click', (event) => {
      const option = event.target.closest('.date-wheel__option');
      if (option) updateDatePart(part, Number(option.dataset.value));
    });
    wheel.addEventListener('scroll', () => {
      if (wheel.dataset.updating === 'true') return;
      clearTimeout(scrollTimers.get(wheel));
      scrollTimers.set(wheel, setTimeout(() => {
        const options = [...wheel.querySelectorAll('.date-wheel__option')];
        const selectedIndex = Math.min(options.length - 1, Math.max(0, Math.round(wheel.scrollTop / 44)));
        if (options[selectedIndex]) updateDatePart(part, Number(options[selectedIndex].dataset.value));
      }, 90));
    }, { passive: true });
    wheel.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      const options = [...wheel.querySelectorAll('.date-wheel__option')];
      const index = options.findIndex((option) => Number(option.dataset.value) === dateState[part]);
      const next = options[Math.min(options.length - 1, Math.max(0, index + delta))];
      if (next) updateDatePart(part, Number(next.dataset.value));
    });
  }

  function openDatePicker() {
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDateInput.value) ? new Date(`${birthDateInput.value}T00:00:00`) : null;
    dateState.day = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getDate() : 1;
    dateState.month = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getMonth() + 1 : 1;
    dateState.year = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getFullYear() : currentYear - 10;
    for (const [wheel, part] of wheels) setWheel(wheel, part);
    if (!birthDateDialog.open) birthDateDialog.showModal();
  }

  document.querySelector('#birth-date-trigger')?.addEventListener('click', openDatePicker);
  birthDateInput.addEventListener('click', openDatePicker);
  document.querySelector('#birth-date-cancel')?.addEventListener('click', () => birthDateDialog.close());
  document.querySelector('#birth-date-confirm')?.addEventListener('click', () => {
    birthDateInput.value = `${dateState.year}-${String(dateState.month).padStart(2, '0')}-${String(dateState.day).padStart(2, '0')}`;
    birthDateInput.dispatchEvent(new Event('change', { bubbles: true }));
    birthDateDialog.close();
  });
}

const messages = {
  studentName: 'Укажите ФИО ученика.',
  birthDate: 'Укажите дату рождения.',
  guardianName: 'Укажите имя родителя или опекуна.',
  phone: 'Введите номер телефона.',
  program: 'Выберите программу обучения.',
  consent: 'Необходимо согласие на обработку данных.'
};

function validateField(field) {
  const container = field.closest('.field') || field.parentElement;
  const error = document.querySelector(`#${field.id}-error`);
  const empty = field.type === 'checkbox' ? !field.checked : !field.value.trim();
  const invalidPhone = field.name === 'phone' && field.value.trim() && field.value.replace(/\D/g, '').length < 7;
  const invalidBirthDate = field.name === 'birthDate' && field.value.trim() && !isValidBirthDate(field.value.trim());
  const message = empty ? messages[field.name] : invalidPhone ? 'Введите телефон полностью.' : invalidBirthDate ? 'Выберите корректную дату рождения.' : '';
  field.setAttribute('aria-invalid', String(Boolean(message)));
  container.classList.toggle('invalid', Boolean(message));
  if (error) error.textContent = message;
  return !message;
}

function isValidBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getTime() <= todayUtc;
}

requiredFields.forEach((field) => {
  field.addEventListener('blur', () => validateField(field));
  field.addEventListener('change', () => validateField(field));
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  const valid = requiredFields.map(validateField).every(Boolean);
  if (!valid) {
    status.textContent = 'Проверьте поля, отмеченные красным.';
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Отправляем…';
  try {
    const response = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Не удалось отправить заявку. Попробуйте позже.');
  } catch (error) {
    status.textContent = error.message;
    submitButton.disabled = false;
    submitButton.innerHTML = 'Отправить заявку <span aria-hidden="true">→</span>';
    return;
  }
  form.hidden = true;
  const confirmation = document.createElement('div');
  confirmation.className = 'success-message';
  confirmation.setAttribute('role', 'status');
  confirmation.setAttribute('tabindex', '-1');
  confirmation.innerHTML = '<span class="success-icon" aria-hidden="true">✓</span><h3>Заявка принята</h3><p>Благодарим за доверие. Мы свяжемся с вами после рассмотрения заявки.</p><button class="button" type="button">Отправить ещё одну заявку</button>';
  form.parentElement.append(confirmation);
  confirmation.focus();
  confirmation.querySelector('button').addEventListener('click', () => {
    confirmation.remove(); form.reset(); form.hidden = false; document.querySelector('#student-name').focus();
  });
});

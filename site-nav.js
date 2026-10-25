/* Shared navigation replaces the page-specific duplicate menus. */
const pages = [
  { href: 'about.html', label: 'О медресе', icon: '☾' },
  { href: 'teachers.html', label: 'Устазы', icon: '✦' },
  { href: 'curriculum.html', label: 'Учебный план', icon: '⌘' },
  { href: 'media.html', label: 'Жизнь медресе', icon: '◈' },
  { href: 'apply.html', label: 'Подать заявку', icon: '✎', prominent: true }
];
const current = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('header .nav').forEach((navigation) => navigation.remove());
document.querySelectorAll('header.page-header:not(.registration-header)').forEach((header) => header.remove());
const navigation = document.createElement('nav');
navigation.className = 'book-tabs';
navigation.setAttribute('aria-label', 'Разделы сайта');
navigation.innerHTML = `<div class="book-tabs__inner"><a class="book-tabs__brand" href="index.html"><span class="brand-mark" aria-hidden="true">أ</span><span>Ал Бушра</span></a>${pages.map((page) => `<a href="${page.href}" class="${page.prominent ? 'book-tabs__apply' : ''} ${page.href === current ? 'is-active' : ''}"><span aria-hidden="true">${page.icon}</span>${page.label}</a>`).join('')}</div>`;
document.body.prepend(navigation);

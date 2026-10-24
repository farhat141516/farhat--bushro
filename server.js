"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getPool, saveApplication, listApplications, updateApplicationStatus } = require("./db");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3001);
const WEBHOOK_URL = process.env.APPLICATION_WEBHOOK_URL;
const MAX_BODY_BYTES = 12_000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 16 * 1024;
const MAX_CONTENT_REQUEST_BYTES = 128 * 1024;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE_SECURE = process.env.NODE_ENV === "production" ? "; Secure" : "";
const uploadDirectory = path.join(__dirname, "uploads");
const contentPath = path.join(uploadDirectory, "content.json");
const programs = new Set(["Начальный уровень", "Основная программа", "Изучение Корана", "Арабский язык"]);
const requests = new Map();
const adminLoginFailures = new Map();
const publicFiles = new Map([
  ["/", "index.html"], ["/index.html", "index.html"], ["/styles.css", "styles.css"], ["/app.js", "app.js"], ["/swagger-init.js", "swagger-init.js"],
  ["/api/openapi.yaml", "openapi.yaml"], ["/openapi.yaml", "openapi.yaml"], ["/api/swagger.json", "swagger.json"], ["/swagger.json", "swagger.json"], ["/swagger", "swagger.html"],
  ["/swagger/", "swagger.html"], ["/about", "about.html"], ["/about.html", "about.html"], ["/teachers", "teachers.html"], ["/teachers.html", "teachers.html"], ["/apply", "apply.html"], ["/apply.html", "apply.html"],
  ["/curriculum", "curriculum.html"], ["/curriculum.html", "curriculum.html"], ["/media", "media.html"], ["/media.html", "media.html"], ["/mosque-background.png", "mosque-background.png"],
  ["/site-nav.js", "site-nav.js"], ["/admin/login", "admin-login.html"], ["/admin-login.html", "admin-login.html"], ["/admin-login.js", "admin-login.js"], ["/admin", "admin.html"], ["/admin.js", "admin.js"], ["/public-page.js", "public-page.js"]
]);

function readContent() {
  const defaults = {
    icons: { about: "▧", teachers: "♙", hafiz: "♙", alim: "♙", benefit1: "✦", benefit2: "◒", benefit3: "⌁" }, photos: [],
    teachers: {
      hafiz: [{ name: "Устаз Абдулла", subject: "Коран и основы исламских знаний" }, { name: "Устаз Мухаммад", subject: "Таджвид и заучивание Корана" }],
      alim: [{ name: "Устаза Амина", subject: "Начальная программа и нравственное воспитание" }, { name: "Устаз Омар", subject: "Арабский язык и история исламской культуры" }]
    }
  };
  try {
    const saved = JSON.parse(fs.readFileSync(contentPath, "utf8"));
    return { ...defaults, ...saved, icons: { ...defaults.icons, ...(saved.icons || {}) }, teachers: { ...defaults.teachers, ...(saved.teachers || {}) } };
  } catch { return defaults; }
}

function makeSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isAdmin(req) {
  const token = (req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("admin_session="))?.split("=")[1];
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(payload, "base64url")).exp > Date.now(); } catch { return false; }
}

function requireAdmin(req, res) { if (!isAdmin(req)) { send(res, 401, { message: "Требуется вход администратора." }); return false; } return true; }

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      if (Buffer.byteLength(body) + chunk.length > maxBytes) {
        tooLarge = true;
        body = "";
        reject(new Error("body-too-large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  pruneRateLimitMap(requests);
  const now = Date.now();
  const active = (requests.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  active.push(now);
  requests.set(ip, active);
  return active.length > MAX_REQUESTS;
}

function pruneRateLimitMap(rateMap) {
  if (rateMap.size <= 5_000) return;
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, attempts] of rateMap) {
    const active = attempts.filter((time) => time >= cutoff);
    if (active.length) rateMap.set(ip, active);
    else rateMap.delete(ip);
  }
  while (rateMap.size > 5_000) rateMap.delete(rateMap.keys().next().value);
}

function isAdminLoginRateLimited(ip) {
  pruneRateLimitMap(adminLoginFailures);
  const active = (adminLoginFailures.get(ip) || []).filter((time) => Date.now() - time < WINDOW_MS);
  adminLoginFailures.set(ip, active);
  return active.length >= MAX_REQUESTS;
}

function recordAdminLoginFailure(ip) {
  pruneRateLimitMap(adminLoginFailures);
  const active = (adminLoginFailures.get(ip) || []).filter((time) => Date.now() - time < WINDOW_MS);
  active.push(Date.now());
  adminLoginFailures.set(ip, active);
}

function hasValidImageSignature(buffer, extension) {
  if (extension === "png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === "jpg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return extension === "webp" && buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
}

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function validate(payload) {
  const data = {
    studentName: text(payload.studentName, 120),
    birthDate: text(payload.birthDate, 10),
    guardianName: text(payload.guardianName, 120),
    phone: text(payload.phone, 30),
    program: text(payload.program, 80),
    comment: text(payload.comment, 1_000),
    consent: payload.consent === "on" || payload.consent === true
  };
  if (text(payload.website, 100)) return { error: "Запрос отклонён." };
  if (!data.studentName || !data.guardianName || !data.phone || !data.birthDate || !data.consent) return { error: "Заполните все обязательные поля." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.birthDate) || Number.isNaN(Date.parse(`${data.birthDate}T00:00:00Z`))) return { error: "Укажите корректную дату рождения." };
  if (data.phone.replace(/\D/g, "").length < 7) return { error: "Укажите корректный номер телефона." };
  if (!programs.has(data.program)) return { error: "Выберите программу из списка." };
  return { data };
}

async function deliverApplication(data) {
  const applicationId = await saveApplication(data);
  if (!WEBHOOK_URL) return applicationId;
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Al-Bushra-Application-API/1.0" },
      body: JSON.stringify({ type: "application.created", submittedAt: new Date().toISOString(), application: data }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Delivery failed with status ${response.status}`);
  } catch (error) {
    console.error("Application webhook delivery failed.");
  }
  return applicationId;
}

function serveFile(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/uploads/") && /^[\w.-]+$/.test(path.basename(pathname))) {
    const filePath = path.join(uploadDirectory, path.basename(pathname));
    if (!fs.existsSync(filePath)) return send(res, 404, { message: "Не найдено." });
    const type = path.extname(filePath) === ".png" ? "image/png" : path.extname(filePath) === ".webp" ? "image/webp" : "image/jpeg";
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=3600" });
    return fs.createReadStream(filePath).pipe(res);
  }
  const filename = publicFiles.get(pathname);
  if (!filename) return send(res, 404, { message: "Не найдено." });
  const filePath = path.join(__dirname, filename);
  const type = filename.endsWith(".css") ? "text/css" : filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".png") ? "image/png" : filename.endsWith(".yaml") ? "application/yaml" : filename.endsWith(".json") ? "application/json" : "text/html";
  const contentType = type.startsWith("image/") ? type : `${type}; charset=utf-8`;
  res.writeHead(200, { "Content-Type": contentType, "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res, adminServer = false) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src https://fonts.gstatic.com; script-src 'self' https://unpkg.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

  if (req.method === "OPTIONS") {
    res.writeHead(204, { Allow: "GET, POST, PATCH, OPTIONS" });
    return res.end();
  }
  
  if (req.method === "GET") {
    if (req.url === "/health") {
      try {
        const database = getPool();
        if (!database) return send(res, 503, { status: "unavailable", database: "not configured" });
        await database.query("SELECT 1");
        return send(res, 200, { status: "ok", database: "connected", timestamp: new Date().toISOString() });
      } catch {
        return send(res, 503, { status: "unavailable", database: "unreachable" });
      }
    }
    if (req.url === "/api/applications") {
      if (!adminServer) return send(res, 404, { message: "Не найдено." });
      if (!requireAdmin(req, res)) return;
      try { return send(res, 200, { applications: await listApplications() }); }
      catch { return send(res, 503, { message: "Не удалось получить заявки." }); }
    }
    if (req.url === "/api/content") return send(res, 200, readContent());
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!adminServer && (pathname.startsWith("/admin") || ["/admin-login.html", "/admin-login.js", "/admin.js"].includes(pathname))) return send(res, 404, { message: "Не найдено." });
    if (adminServer && pathname === "/admin" && !isAdmin(req)) {
      res.writeHead(302, { Location: "/admin/login" });
      return res.end();
    }
    return serveFile(req, res);
  }
  if (req.method === "POST" && req.url === "/api/admin/login") {
    if (!adminServer) return send(res, 404, { message: "Не найдено." });
    const ip = clientIp(req);
    if (isAdminLoginRateLimited(ip)) return send(res, 429, { message: "Слишком много попыток входа. Повторите через 15 минут." });
    try {
      const payload = JSON.parse(await readBody(req));
      if (!ADMIN_PASSWORD || payload.login !== ADMIN_LOGIN || payload.password !== ADMIN_PASSWORD) {
        recordAdminLoginFailure(ip);
        return send(res, 401, { message: "Неверный логин или пароль." });
      }
      adminLoginFailures.delete(ip);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": `admin_session=${makeSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${COOKIE_SECURE}` });
      return res.end(JSON.stringify({ message: "Вход выполнен." }));
    } catch { return send(res, 400, { message: "Некорректный запрос." }); }
  }
  if (req.method === "POST" && req.url === "/api/admin/logout") {
    if (!adminServer) return send(res, 404, { message: "Не найдено." });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": `admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${COOKIE_SECURE}` });
    return res.end(JSON.stringify({ message: "Вы вышли." }));
  }
  if (req.method === "POST" && req.url === "/api/admin/content") {
    if (!adminServer) return send(res, 404, { message: "Не найдено." });
    if (!requireAdmin(req, res)) return;
    try {
      const payload = JSON.parse(await readBody(req, MAX_CONTENT_REQUEST_BYTES));
      const content = readContent();
      if (payload.icons && typeof payload.icons === "object") content.icons = Object.fromEntries(Object.entries({ ...content.icons, ...payload.icons }).filter(([name, value]) => /^[a-z0-9]+$/.test(name) && typeof value === "string").map(([name, value]) => [name, value.slice(0, 8)]));
      if (Array.isArray(payload.photos)) content.photos = payload.photos.filter((photo) => typeof photo === "string" && /^\/uploads\/[\w.-]+$/.test(photo)).slice(0, 6);
      if (payload.teachers && Array.isArray(payload.teachers.hafiz) && Array.isArray(payload.teachers.alim)) content.teachers = {
        hafiz: payload.teachers.hafiz.map((teacher) => ({ name: text(teacher.name, 100), subject: text(teacher.subject, 160) })).filter((teacher) => teacher.name).slice(0, 20),
        alim: payload.teachers.alim.map((teacher) => ({ name: text(teacher.name, 100), subject: text(teacher.subject, 160) })).filter((teacher) => teacher.name).slice(0, 20)
      };
      fs.mkdirSync(uploadDirectory, { recursive: true }); fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
      return send(res, 200, content);
    } catch (error) { return send(res, error.message === "body-too-large" ? 413 : 400, { message: error.message === "body-too-large" ? "Запрос слишком большой." : "Не удалось сохранить контент." }); }
  }
  if (req.method === "POST" && req.url === "/api/admin/upload") {
    if (!adminServer) return send(res, 404, { message: "Не найдено." });
    if (!requireAdmin(req, res)) return;
    try {
      const payload = JSON.parse(await readBody(req, MAX_UPLOAD_REQUEST_BYTES));
      if (typeof payload.data !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(payload.data)) return send(res, 400, { message: "Поддерживаются JPG, PNG и WebP." });
      const [, encoded] = payload.data.split(",");
      const buffer = Buffer.from(encoded, "base64");
      if (buffer.length > MAX_UPLOAD_BYTES) return send(res, 413, { message: "Файл слишком большой." });
      const extension = payload.data.match(/^data:image\/(jpeg|png|webp);/)[1].replace("jpeg", "jpg");
      if (!hasValidImageSignature(buffer, extension)) return send(res, 400, { message: "Содержимое файла не соответствует формату изображения." });
      const filename = `${crypto.randomUUID()}.${extension}`;
      fs.mkdirSync(uploadDirectory, { recursive: true }); fs.writeFileSync(path.join(uploadDirectory, filename), buffer);
      return send(res, 201, { path: `/uploads/${filename}` });
    } catch (error) { return send(res, error.message === "body-too-large" ? 413 : 400, { message: error.message === "body-too-large" ? "Файл слишком большой." : "Не удалось загрузить фото." }); }
  }
  const statusMatch = req.method === "PATCH" ? req.url.match(/^\/api\/applications\/(\d+)$/) : null;
  if (statusMatch) {
    if (!adminServer) return send(res, 404, { message: "Не найдено." });
    if (!requireAdmin(req, res)) return;
    try {
      const { status } = JSON.parse(await readBody(req));
      if (!["new", "accepted", "rejected"].includes(status)) return send(res, 400, { message: "Недопустимый статус." });
      const updated = await updateApplicationStatus(statusMatch[1], status);
      return updated ? send(res, 200, updated) : send(res, 404, { message: "Заявка не найдена." });
    } catch { return send(res, 503, { message: "Не удалось обновить заявку." }); }
  }
  if (adminServer || req.method !== "POST" || req.url !== "/api/applications") return send(res, 404, { message: "Не найдено." });
  if (isRateLimited(clientIp(req))) return send(res, 429, { message: "Слишком много попыток. Повторите позже." });
  try {
      const check = validate(JSON.parse(await readBody(req)));
      if (check.error) return send(res, 400, { message: check.error });
      await deliverApplication(check.data);
      return send(res, 201, { message: "Заявка принята." });
    } catch (error) {
      if (error.message === "body-too-large") return send(res, 413, { message: "Запрос слишком большой." });
      return send(res, 503, { message: "Сервис приёма заявок временно недоступен. Попробуйте позже." });
    }
}

const publicServer = http.createServer((req, res) => handleRequest(req, res, false));
const adminServer = http.createServer((req, res) => handleRequest(req, res, true));
publicServer.listen(PORT, () => console.log(`Al Bushra public site listening on http://localhost:${PORT}`));
adminServer.listen(ADMIN_PORT, () => console.log(`Al Bushra admin panel listening on http://localhost:${ADMIN_PORT}`));

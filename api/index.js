"use strict";

const { handleRequest } = require("../server");

function originalUrl(req) {
  const requestUrl = new URL(req.url || "/", "https://vercel.invalid");
  const queryRoute = req.query?.route;
  const route = typeof queryRoute === "string" ? queryRoute : requestUrl.searchParams.get("route");
  if (!route || !route.startsWith("/")) return req.url || "/";
  requestUrl.searchParams.delete("route");
  return `${route}${requestUrl.search}`;
}

module.exports = async function vercelHandler(req, res) {
  req.url = originalUrl(req);
  const pathname = new URL(req.url, "https://vercel.invalid").pathname;
  const isAdminRequest = pathname === "/admin"
    || pathname.startsWith("/admin/")
    || ["/admin.js", "/admin-login.html", "/admin-login.js"].includes(pathname)
    || pathname.startsWith("/api/admin/")
    || (pathname === "/api/applications" && req.method !== "POST");

  try {
    await handleRequest(req, res, isAdminRequest);
  } catch {
    if (res.headersSent) return res.end();
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ message: "Внутренняя ошибка сервера." }));
  }
};

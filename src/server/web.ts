import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler } from "express";

/**
 * The simulator page: static files from src/simulator (dev, tests) or dist/simulator (the
 * bundle), plus the security headers every response carries. The page has no inline script or
 * style, so the CSP needs no 'unsafe-inline'.
 */

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
};

/** The simulator directory next to this module, in source or in the bundle; undefined if absent. */
export function simulatorDir(): string | undefined {
  for (const rel of ["../simulator/", "./simulator/"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(`${dir}index.html`)) return dir;
  }
  return undefined;
}

export function simulatorStatic(dir: string): RequestHandler {
  return express.static(dir, {
    index: "index.html",
    dotfiles: "ignore",
    setHeaders(res, path) {
      // Fonts never change; the rest revalidates so a redeploy shows at once.
      res.setHeader("Cache-Control", /\.woff2$/.test(path) ? "public, max-age=604800" : "no-cache");
    },
  });
}

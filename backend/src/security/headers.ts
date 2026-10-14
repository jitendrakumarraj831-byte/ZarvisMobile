import type { NextFunction, Request, Response } from "express";

/**
 * Content-Security-Policy for the web client (also mirrored in vercel.json for the static
 * build). The web client stores its tokens in localStorage, so the main XSS defence is that
 * no script can run except same-origin files: no inline scripts, no eval, no third-party
 * script hosts. Google Fonts CSS/fonts are the only external resources the page loads, plus
 * Razorpay Checkout (script + payment frame) which is only loaded when the user taps Upgrade.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://checkout.razorpay.com https://accounts.google.com/gsi/client",
  "style-src 'self' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.razorpay.com https://*.googleusercontent.com",
  "media-src 'self' blob:",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://checkout.razorpay.com https://accounts.google.com/gsi/",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com https://accounts.google.com/gsi/",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.razorpay.com",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  // Only over HTTPS (req.secure honours the proxy's X-Forwarded-Proto): sent on plain HTTP it is ignored by browsers.
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
}

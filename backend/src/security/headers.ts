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

/**
 * Browser features the page may use. The microphone is for the Speak button; the camera is for
 * "Take a photo" in the composer. Both are asked for by the browser only after a tap (never at
 * load), and only this origin may use them: no embedded frame can. Location stays off.
 * Mirrored in vercel.json (a test keeps the two equal).
 */
export const PERMISSIONS_POLICY = "camera=(self), geolocation=(), microphone=(self)";

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  // Only over HTTPS (req.secure honours the proxy's X-Forwarded-Proto): sent on plain HTTP it is ignored by browsers.
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
}

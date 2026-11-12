// Fallback when the service worker is not running yet: open the app instead of an error page.
export function POST(request) {
  return Response.redirect(new URL('/?share=1', request.url), 303);
}
export function GET(request) {
  return Response.redirect(new URL('/', request.url), 303);
}

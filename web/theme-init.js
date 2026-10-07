/* Runs in <head>, before the first paint: applies the saved theme (or the device's) so a dark
   user never sees a light flash while the app script downloads. Keep it tiny and dependency-free. */
(function () {
  var mode = "dim";
  try {
    var saved = localStorage.getItem("zarvis.appearance");
    if (saved === "dim" || saved === "aurora") mode = saved;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) mode = "aurora";
  } catch (e) {}
  document.documentElement.setAttribute("data-appearance", mode);
  var color = mode === "dim" ? "#0a0d24" : "#f4f3ff";
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) { metas[i].removeAttribute("media"); metas[i].setAttribute("content", color); }
})();

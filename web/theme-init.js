/* Runs in <head>, before the first paint: applies the saved theme so a dark-mode user never sees a
   light flash while the app script downloads. Light is the default for everyone, whatever the device's
   own dark/light setting is; dark is only used once it has been chosen in Settings > Appearance.
   Keep it tiny and dependency-free. */
(function () {
  var mode = "aurora";
  try {
    if (localStorage.getItem("zarvis.appearance") === "dim") mode = "dim";
  } catch (e) {}
  document.documentElement.setAttribute("data-appearance", mode);
  var color = mode === "dim" ? "#0a0d24" : "#f4f3ff";
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) { metas[i].removeAttribute("media"); metas[i].setAttribute("content", color); }
})();

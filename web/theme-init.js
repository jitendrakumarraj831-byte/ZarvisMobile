/* Runs in <head>, before the first paint: applies the saved theme so a dark-mode user never sees a
   light flash while the app script downloads. Light is the default for everyone, whatever the device's
   own dark/light setting is; dark is only used once it has been chosen in Settings > Appearance.

   It also decides "lightweight mode" (data-perf="lite" on <html>), for the same reason: the first frame must already be the
   cheap one. The choice is Settings > Appearance > Performance: "auto" (the default) goes lightweight when the browser says
   the person asked to save data, the connection is 2G/3G, the device has 2 GB of memory or fewer, or it reports reduced
   data; "lite" and "full" force it either way. Lightweight mode drops backdrop blur and decorative loops (see styles.css);
   nothing is removed from the page.
   Keep it tiny and dependency-free. web/tests/themeInit.test.js runs this file against stub browsers. */
(function () {
  var mode = "aurora";
  var perf = "auto";
  try {
    if (localStorage.getItem("zarvis.appearance") === "dim") mode = "dim";
    perf = localStorage.getItem("zarvis.perf") || "auto";
  } catch (e) {}
  document.documentElement.setAttribute("data-appearance", mode);
  var color = mode === "dim" ? "#0a0d24" : "#f4f3ff";
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) { metas[i].removeAttribute("media"); metas[i].setAttribute("content", color); }

  /** true when lightweight mode should be on for [pref] ("auto" | "lite" | "full") on this device and connection. */
  function wantsLite(pref) {
    if (pref === "lite") return true;
    if (pref !== "auto") return false;
    var nav = typeof navigator === "object" && navigator ? navigator : {};
    var link = nav.connection || nav.mozConnection || nav.webkitConnection || {};
    if (link.saveData === true) return true;
    if (/^(slow-)?2g$|^3g$/.test(String(link.effectiveType || ""))) return true;
    if (nav.deviceMemory && nav.deviceMemory <= 2) return true;
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-data: reduce)").matches) return true;
    } catch (e) {}
    return false;
  }

  /** Sets or clears data-perf for [pref]; returns whether lightweight mode is now on. */
  function apply(pref) {
    var lite = wantsLite(pref === "lite" || pref === "full" ? pref : "auto");
    if (lite) document.documentElement.setAttribute("data-perf", "lite");
    else document.documentElement.removeAttribute("data-perf");
    return lite;
  }

  apply(perf);
  window.ZarvisPerf = { apply: apply, wantsLite: wantsLite };

  // The Hindi dictionary (i18n.js, about 160 KB) is only fetched when Hindi is the saved language, so it arrives alongside the app instead of after
  // it. English readers never download it; choosing Hindi later fetches it on the spot (app.js loadI18n).
  try {
    if (localStorage.getItem("zarvis.lang") === "hi") {
      var dictionary = document.createElement("script");
      dictionary.src = "./i18n.js";
      dictionary.async = true;
      dictionary.setAttribute("data-i18n", "");
      // A failed download (offline on a first Hindi visit) is marked: its error event may fire before app.js listens, and
      // app.js then fetches the dictionary again instead of waiting for an event that already happened.
      dictionary.onerror = function () { dictionary.setAttribute("data-i18n-failed", ""); };
      document.head.appendChild(dictionary);
    }
  } catch (e) {}

  // A connection that changes while the page is open (Wi-Fi to 3G in a lift) only matters while the choice is "auto".
  try {
    var link = navigator.connection;
    if (link && link.addEventListener) {
      link.addEventListener("change", function () {
        var current = "auto";
        try { current = localStorage.getItem("zarvis.perf") || "auto"; } catch (e) {}
        if (current === "auto") apply("auto");
      });
    }
  } catch (e) {}
})();

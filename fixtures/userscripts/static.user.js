// ==UserScript==
// @name        Fictional Static Locator
// @match       https://example.invalid/*
// @grant       none
// @run-at      document-idle
// ==/UserScript==
(function boot() {
  const primary = document.querySelector('#primary');
  const alternate = document.querySelector('.fallback');
  const target = document.querySelector('#missing') || document.getElementById('backup');
  const parent = primary?.closest('.container');
  return { alternate, target, parent };
})();

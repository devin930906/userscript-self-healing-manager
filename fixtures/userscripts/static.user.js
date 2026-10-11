// ==UserScript==
// @name Fictional Static Selector Fixture
// @match https://fixture.example.invalid/*
// @match https://another.example.invalid/*
// @grant none
// @run-at document-idle
// ==/UserScript==
// Synthetic fixture only. Never run against a real website.
function locatePanel() {
  const panel = document.querySelector('#panel') || document.getElementById('panel-fallback');
  const control = panel?.closest('.controls');
  return { panel, control };
}

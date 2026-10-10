// ==UserScript==
// @name Fictional Dynamic Selector Fixture
// @match https://fixture.example.invalid/*
// @grant none
// @run-at document-end
// ==/UserScript==
// Synthetic fixture: expressions are only parsed, never evaluated.
function locateDynamic(key, part, selector) {
  const template = document.querySelector(`[data-key="${key}"]`);
  const concat = document.getElementById('element-' + part);
  const unknown = document.querySelector(selector);
  return template || concat || unknown;
}

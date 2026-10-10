// ==UserScript==
// @name Fictional Dynamic Locator
// @match https://example.invalid/*
// @grant none
// @run-at document-end
// ==/UserScript==
function locate(key) {
  return document.querySelector(`[data-key="${key}"]`) || document.querySelector('#fallback');
}
function concatenated(part) {
  return document.querySelector('#' + part);
}
function wrapper(selector) {
  return document.querySelector(selector);
}

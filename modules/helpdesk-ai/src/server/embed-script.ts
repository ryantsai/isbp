/**
 * `embed.js`: the chat bubble other websites add with
 *
 *   <script src="https://isbp.example.com/api/v1/helpdesk-ai/published/embed.js" data-chat="<token>" defer></script>
 *
 * Optional: `data-label` (the button's name, default "Ask IS"), `data-position` (`left` or `right`), `data-color`
 * (a hex colour for the button). It runs on someone else's page, so it is plain JavaScript in a shadow root (the
 * page's CSS can't reach it, it doesn't reach the page) and only opens the platform's own chat page in a frame:
 * the conversation never touches the host page. The host must be one of the chat's allowed websites, or the
 * browser refuses the frame (`frame-ancestors`).
 */
export const EMBED_SCRIPT = String.raw`(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || !script.dataset.chat) return;
  var token = script.dataset.chat;
  var registry = (window.__isbpChat = window.__isbpChat || {});
  if (registry[token]) return;
  registry[token] = true;

  var base = new URL(script.src).origin;
  var label = script.dataset.label || 'Ask IS';
  var side = script.dataset.position === 'left' ? 'left' : 'right';
  var color = /^#[0-9a-f]{3,8}$/i.test(script.dataset.color || '') ? script.dataset.color : '#0b4f8a';
  var src = base + '/p/helpdesk-ai/chat/' + encodeURIComponent(token) + '?embed=1';

  var host = document.createElement('div');
  host.setAttribute('data-isbp-chat', token);
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:20px;' + side + ':20px;';
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    'button{all:unset;box-sizing:border-box;width:56px;height:56px;border-radius:50%;background:' + color +
      ';color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)}',
    'button:focus-visible{outline:3px solid #111;outline-offset:3px}',
    'svg{width:26px;height:26px}',
    '.panel{position:fixed;bottom:88px;' + side + ':20px;width:min(400px,calc(100vw - 40px));' +
      'height:min(640px,calc(100vh - 120px));border-radius:12px;overflow:hidden;background:#fff;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.3);display:none}',
    '.panel.open{display:block}',
    'iframe{border:0;width:100%;height:100%}',
    '@media (max-width:480px){.panel{bottom:0;left:0;right:0;width:100vw;height:calc(100vh - 88px);border-radius:0}}',
    '@media (prefers-reduced-motion:no-preference){.panel.open{animation:in .18s ease-out}}',
    '@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
  ].join('');

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'isbp-chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', label);

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-controls', 'isbp-chat-panel');
  button.setAttribute('aria-expanded', 'false');
  var chatIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  var closeIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  button.innerHTML = chatIcon;

  var frame = null;
  function setOpen(open) {
    if (open && !frame) {
      // Loaded on first open: a page that never opens the chat never contacts the platform.
      frame = document.createElement('iframe');
      frame.src = src;
      frame.title = label;
      frame.setAttribute('referrerpolicy', 'strict-origin');
      panel.appendChild(frame);
    }
    panel.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    button.innerHTML = open ? closeIcon : chatIcon;
    if (open && frame) frame.focus();
    else button.focus();
  }
  button.addEventListener('click', function () {
    setOpen(!panel.classList.contains('open'));
  });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) setOpen(false);
  });
  // The chat page asks to close (its own close button, or Escape inside it). Only from that frame.
  window.addEventListener('message', function (e) {
    if (!frame || e.origin !== base || e.source !== frame.contentWindow) return;
    if (e.data && e.data.type === 'isbp-chat:close') setOpen(false);
  });

  root.appendChild(style);
  root.appendChild(panel);
  root.appendChild(button);
  (document.body || document.documentElement).appendChild(host);
})();
`;

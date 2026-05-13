// reactlens — portal interactivity.
// Vanilla, no build step. Mermaid is loaded by the page; we just configure it.

(function () {
  'use strict';

  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: true,
      theme: 'neutral',
      themeVariables: {
        fontFamily:
          '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        primaryColor: '#eef2ff',
        primaryBorderColor: '#4f46e5',
        primaryTextColor: '#0f172a',
        lineColor: '#94a3b8',
        secondaryColor: '#f1f5f9',
        tertiaryColor: '#fff7ed',
      },
      flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
      sequence: { useMaxWidth: true, mirrorActors: false },
      securityLevel: 'loose',
    });
  }

  const header = document.getElementById('site-header');
  if (header) {
    const onScroll = () => {
      if (window.scrollY > 8) header.classList.add('is-scrolled');
      else header.classList.remove('is-scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  const navLinks = Array.from(document.querySelectorAll('[data-nav]'));
  const sections = navLinks
    .map((a) => document.getElementById(a.dataset.nav))
    .filter(Boolean);

  if (sections.length > 0 && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = visible.target.id;
        navLinks.forEach((link) => {
          link.classList.toggle('is-active', link.dataset.nav === id);
        });
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: [0, 0.1, 0.4, 0.7, 1] },
    );
    sections.forEach((s) => observer.observe(s));
  }

  const tabContainers = document.querySelectorAll('.tabs');
  tabContainers.forEach((tabs) => {
    const buttons = tabs.querySelectorAll('.tab-btn');
    const panels = tabs.querySelectorAll('.tab-panel');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        buttons.forEach((b) => {
          const active = b.dataset.tab === target;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });
        panels.forEach((p) => {
          p.classList.toggle('is-active', p.dataset.panel === target);
        });
      });
    });
  });

  document.querySelectorAll('.kan-col').forEach((col) => {
    const count = col.querySelectorAll('.kan-card').length;
    const target = col.querySelector('.count');
    if (target) target.textContent = String(count);
  });

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const wrap = btn.closest('.code-wrap');
      const pre = wrap && wrap.querySelector('pre.code');
      if (!pre) return;
      const text = pre.innerText;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try { document.execCommand('copy'); } catch {}
        sel.removeAllRanges();
      }
      const original = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('is-copied');
      }, 1500);
    });
  });

  const modal = document.getElementById('zoom-modal');
  const stage = document.getElementById('zoom-stage');
  let zoomState = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };

  function applyTransform() {
    if (!stage || !stage.firstElementChild) return;
    stage.firstElementChild.style.transform =
      'translate(' + zoomState.x + 'px, ' + zoomState.y + 'px) scale(' + zoomState.scale + ')';
  }

  function openZoom(sourceEl) {
    const inner = sourceEl.querySelector('.mermaid, .gantt, .kanban');
    if (!inner || !stage || !modal) return;
    stage.innerHTML = '';
    const clone = inner.cloneNode(true);
    clone.style.maxWidth = 'none';
    clone.style.width = 'fit-content';
    clone.style.height = 'fit-content';
    stage.appendChild(clone);
    zoomState = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };
    applyTransform();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeZoom() {
    if (!modal || !stage) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    stage.innerHTML = '';
  }

  document.querySelectorAll('.diagram').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      openZoom(el);
    });
  });

  document.querySelectorAll('[data-zoom-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.zoomAction;
      if (action === 'close') {
        closeZoom();
        return;
      }
      if (action === 'in') zoomState.scale = Math.min(zoomState.scale * 1.2, 6);
      if (action === 'out') zoomState.scale = Math.max(zoomState.scale / 1.2, 0.2);
      if (action === 'reset') {
        zoomState.scale = 1;
        zoomState.x = 0;
        zoomState.y = 0;
      }
      applyTransform();
    });
  });

  if (stage) {
    stage.addEventListener(
      'wheel',
      (e) => {
        if (!modal || !modal.classList.contains('is-open')) return;
        e.preventDefault();
        const delta = -e.deltaY * 0.0015;
        const next = Math.min(Math.max(zoomState.scale + delta * zoomState.scale, 0.2), 6);
        const rect = stage.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const ratio = next / zoomState.scale;
        zoomState.x = cx - (cx - zoomState.x) * ratio;
        zoomState.y = cy - (cy - zoomState.y) * ratio;
        zoomState.scale = next;
        applyTransform();
      },
      { passive: false },
    );

    stage.addEventListener('mousedown', (e) => {
      zoomState.dragging = true;
      zoomState.lastX = e.clientX;
      zoomState.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => {
      zoomState.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!zoomState.dragging) return;
      zoomState.x += e.clientX - zoomState.lastX;
      zoomState.y += e.clientY - zoomState.lastY;
      zoomState.lastX = e.clientX;
      zoomState.lastY = e.clientY;
      applyTransform();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('is-open')) closeZoom();
  });

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeZoom();
    });
  }
})();

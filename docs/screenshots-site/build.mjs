#!/usr/bin/env node
/**
 * Build script for docs/screenshots-site/
 *
 * Reads screenshots from ../screenshots, generates index.html with
 * self-hosted fonts inlined as base64, and handles all 404 fallbacks.
 *
 * Run: node build.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname);
const SCREENSHOTS_DIR = join(ROOT, '../screenshots');
const FONTS_DIR = join(ROOT, '../../catalyst-frontend/dist/assets');
const OUT = join(ROOT, 'index.html');

// ── Fonts ─────────────────────────────────────────────────────────────────

function fontFiles(pattern) {
  try {
    return readdirSync(FONTS_DIR)
      .filter(f => f.startsWith(pattern) && f.endsWith('.woff2'))
      .map(f => ({ path: join(FONTS_DIR, f), file: f }))
      .sort();
  } catch { return []; }
}

function base64FontFace(family, weight, files) {
  const srcs = files.map(({ path }) =>
    `url('data:font/woff2;base64,${readFileSync(path).toString('base64')}') format('woff2')`
  ).join(',\n    ');
  return [
    `@font-face {`,
    `  font-family: '${family}';`,
    `  font-weight: ${weight};`,
    `  font-style: normal;`,
    `  font-display: swap;`,
    `  src:`,
    `    ${srcs}`,
    `}`,
  ].join('\n');
}

const fontCSS = [
  base64FontFace('DM Sans', '100 1000', fontFiles('dm-sans')),
  base64FontFace('Outfit', '100 900', fontFiles('outfit')),
  base64FontFace('JetBrains Mono', '100 800', fontFiles('jetbrains-mono')),
].join('\n\n');

// ── Screenshots ───────────────────────────────────────────────────────────

const CATEGORIES = {
  auth:  { label: 'Authentication',       description: 'Login, registration, and password recovery flows',             icon: '🔐' },
  user:  { label: 'User Dashboard',        description: 'Server management, monitoring, and day-to-day operations', icon: '👤' },
  admin: { label: 'Administration',         description: 'System-wide controls, node management, and platform configuration', icon: '⚙️' },
};

function titleFromFile(filename) {
  return filename
    .replace(/\.png$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Admin/g, 'Admin')
    .replace(/Api/g, 'API')
    .replace(/Sftp/g, 'SFTP')
    .replace(/Modmanager/g, 'Mod Manager')
    .replace(/Pluginmanager/g, 'Plugin Manager')
    .replace(/Databases/g, 'Databases')
    .replace(/Metrics/g, 'Metrics')
    .replace(/Tasks/g, 'Tasks')
    .replace(/Configuration/g, 'Configuration')
    .replace(/Settings/g, 'Settings')
    .replace(/Alerts/g, 'Alerts')
    .replace(/Users/g, 'Users')
    .replace(/Console/g, 'Console')
    .replace(/Files/g, 'Files')
    .replace(/Backups/g, 'Backups');
}

const screenshots = {};
let totalCount = 0;

for (const [cat, meta] of Object.entries(CATEGORIES)) {
  const catDir = join(SCREENSHOTS_DIR, cat);
  screenshots[cat] = [];
  if (existsSync(catDir)) {
    for (const file of readdirSync(catDir).filter(f => f.endsWith('.png')).sort()) {
      screenshots[cat].push({
        file,
        title: titleFromFile(file),
        path: `./screenshots/${cat}/${file}`,
      });
      totalCount++;
    }
  }
}

// ── JS data ─────────────────────────────────────────────────────────────

const allImagesJS = Object.entries(CATEGORIES)
  .flatMap(([cat]) => screenshots[cat].map(img =>
    `{ path: './screenshots/${cat}/${img.file}', title: "${img.title.replace(/"/g, '\\"')}" }`
  ))
  .join(',\n    ');

// ── HTML builders ────────────────────────────────────────────────────────

function screenshotCard(img, featured) {
  const cls = featured ? 'screenshot-card featured' : 'screenshot-card';
  const aspect = featured ? '16/9' : '16/12.3';
  const badge = featured ? '' : `<span class="card-badge">Screenshot</span>`;
  return [
    `<div class="${cls}" data-src="./screenshots/${img.path.split('/screenshots/')[1]}" data-title="${img.title.replace(/"/g, '&quot;')}">`,
    `  <div class="thumb-wrap" style="aspect-ratio:${aspect}">`,
    `    <img src="./screenshots/${img.path.split('/screenshots/')[1]}" alt="${img.title.replace(/"/g, '&quot;')}" loading="${featured ? 'eager' : 'lazy'}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`,
    `    <div class="thumb-error" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;flex-direction:column;gap:0.5rem;color:var(--fg-muted);font-size:0.75rem;">`,
    `      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9l4-4 4 4 4-4 4 4"/></svg>`,
    `      Screenshot unavailable`,
    `    </div>`,
    `    <div class="thumb-overlay"><span class="zoom-hint">Click to expand</span></div>`,
    `  </div>`,
    `  <div class="card-info">`,
    `    <span class="card-title">${img.title}</span>`,
    `    ${badge}`,
    `  </div>`,
    `</div>`,
  ].join('\n');
}

function sectionHTML(cat, images, meta) {
  if (!images || images.length === 0) return '';
  const featured = images[0];
  const rest = images.slice(1);
  return [
    `<section class="section" id="${cat}">`,
    `  <div class="section-header">`,
    `    <div class="section-title-row">`,
    `      <span class="section-icon">${meta.icon}</span>`,
    `      <div>`,
    `        <h2>${meta.label}</h2>`,
    `        <p>${meta.description}</p>`,
    `      </div>`,
    `    </div>`,
    `    <span class="section-count">${images.length} screenshot${images.length !== 1 ? 's' : ''}</span>`,
    `  </div>`,
    `  <div class="gallery-grid">`,
    featured ? screenshotCard(featured, true) : '',
    ...rest.map(img => screenshotCard(img, false)),
    `  </div>`,
    `</section>`,
    `<div class="section-divider"><hr/></div>`,
  ].filter(Boolean).join('\n');
}

const sectionsHTML = Object.entries(CATEGORIES)
  .map(([cat, meta]) => sectionHTML(cat, screenshots[cat], meta))
  .filter(Boolean)
  .join('\n');

const authCount = screenshots.auth?.length || 0;
const userCount = screenshots.user?.length || 0;
const adminCount = screenshots.admin?.length || 0;
const cats = Object.values(screenshots).filter(a => a.length > 0).length;
const emptyState = totalCount === 0
  ? `<div class="empty-state"><p>No screenshots found. Run <code>bun run test:screenshots</code> in <code>catalyst-frontend/</code> to generate them.</p></div>`
  : sectionsHTML;

// ── Write HTML ──────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Catalyst — Screenshots</title>
  <meta name="description" content="Explore the Catalyst game server management panel through screenshots." />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23174155'/><path d='M10 8l6 8-6 8M18 24h4' stroke='%2322d3ee' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/></svg>" />
  <style>
/*** Design Tokens ***/
:root {
  --bg:          hsl(240 10% 3.9%);
  --bg-2:        hsl(240 10% 7%);
  --surface:      hsl(240 10% 9%);
  --surface-2:    hsl(240 3.7% 15.9%);
  --surface-3:    hsl(240 5.9% 24%);
  --border:      hsl(240 3.7% 15.9%);
  --fg:          hsl(0 0% 98%);
  --fg-muted:    hsl(240 5% 64.9%);
  --teal:        hsl(174 80% 46%);
  --teal-light:  hsl(174 72% 56%);
  --teal-dim:    hsl(174 80% 46% / 0.12);
  --amber:       hsl(38 92% 50%);
  --rose:        hsl(0 84% 60%);
  --radius:      0.75rem;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'DM Sans',system-ui,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--surface-3);border-radius:3px}
*{scrollbar-width:thin;scrollbar-color:var(--surface-3) transparent}

/*** Self-hosted fonts (inlined WOFF2) ***/
${fontCSS}

/*** Header ***/
.site-header{position:sticky;top:0;z-index:50;background:hsl(240 10% 3.9% / 0.88);backdrop-filter:blur(20px) saturate(180%);border-bottom:1px solid var(--border)}
.header-inner{max-width:1280px;margin:0 auto;padding:0 2rem;height:64px;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:0.75rem;text-decoration:none}
.logo-mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--teal),hsl(174 80% 32%));display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:white;box-shadow:0 0 24px hsl(174 80% 46% / 0.28)}
.logo-text{font-family:'Outfit',system-ui,sans-serif;font-size:1.125rem;font-weight:700;color:var(--fg);letter-spacing:-0.02em}
.logo-badge{font-family:'JetBrains Mono',monospace;font-size:0.6rem;font-weight:600;padding:2px 7px;border-radius:4px;background:var(--teal-dim);color:var(--teal-light);border:1px solid hsl(174 80% 46% / 0.2);letter-spacing:0.04em}
.nav{display:flex;gap:0.25rem}
.nav-link{padding:6px 14px;border-radius:7px;font-size:0.8125rem;font-weight:500;color:var(--fg-muted);text-decoration:none;transition:all 0.15s;border:none;background:none;cursor:pointer;font-family:inherit}
.nav-link:hover{color:var(--fg);background:var(--surface-2)}
.nav-link.active{color:var(--teal-light);background:var(--teal-dim)}

/*** Hero ***/
.hero{position:relative;overflow:hidden;border-bottom:1px solid var(--border)}
.hero-glow{position:absolute;top:-150px;right:-100px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,hsl(174 80% 46% / 0.07) 0%,transparent 70%);pointer-events:none}
.hero-inner{max-width:1280px;margin:0 auto;padding:4.5rem 2rem 4rem;position:relative;z-index:1;text-align:center}
.hero-badge{display:inline-flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:0.6875rem;font-weight:500;color:var(--teal-light);padding:4px 12px;border-radius:999px;border:1px solid hsl(174 80% 46% / 0.22);background:hsl(174 80% 46% / 0.08);margin-bottom:1.5rem;letter-spacing:0.03em}
.hero-badge-dot{width:6px;height:6px;border-radius:50%;background:var(--teal);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.hero h1{font-family:'Outfit',system-ui,sans-serif;font-size:clamp(2rem,5vw,3.5rem);font-weight:800;line-height:1.08;letter-spacing:-0.03em;color:var(--fg);margin-bottom:1rem}
.hero h1 .accent{background:linear-gradient(135deg,var(--teal-light),var(--teal));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero p{font-size:1.0625rem;color:var(--fg-muted);max-width:520px;margin:0 auto;line-height:1.65}

/*** Stats ***/
.stats-bar{max-width:1280px;margin:0 auto;padding:2.5rem 2rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem}
.stat-card{display:flex;align-items:center;gap:1rem;padding:1.25rem;border-radius:14px;border:1px solid var(--border);background:var(--surface);transition:border-color 0.2s}
.stat-card:hover{border-color:hsl(174 80% 46% / 0.3)}
.stat-icon{width:44px;height:44px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.stat-icon.teal{background:hsl(174 80% 46% / 0.12)}
.stat-icon.amber{background:hsl(38 92% 50% / 0.12)}
.stat-icon.rose{background:hsl(0 84% 60% / 0.12)}
.stat-value{font-family:'Outfit',system-ui,sans-serif;font-size:1.75rem;font-weight:700;color:var(--fg);line-height:1.1}
.stat-label{font-size:0.8125rem;color:var(--fg-muted);margin-top:2px}

/*** Section ***/
.section{max-width:1280px;margin:0 auto;padding:3rem 2rem 2rem}
.section-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:2rem;gap:1rem}
.section-title-row{display:flex;align-items:flex-start;gap:1rem}
.section-icon{font-size:1.75rem;line-height:1;flex-shrink:0;margin-top:2px}
.section-header h2{font-family:'Outfit',system-ui,sans-serif;font-size:1.5rem;font-weight:700;color:var(--fg);letter-spacing:-0.02em;margin-bottom:0.375rem}
.section-header p{font-size:0.875rem;color:var(--fg-muted)}
.section-count{font-family:'JetBrains Mono',monospace;font-size:0.6875rem;font-weight:600;color:var(--teal-light);padding:4px 10px;border-radius:6px;background:var(--teal-dim);border:1px solid hsl(174 80% 46% / 0.15);white-space:nowrap;flex-shrink:0;margin-top:4px}
.section-divider{max-width:1280px;margin:0 auto;padding:0 2rem}
.section-divider hr{border:none;border-top:1px solid var(--border)}

/*** Gallery grid ***/
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1rem}
.screenshot-card{position:relative;border-radius:14px;border:1px solid var(--border);background:var(--surface);overflow:hidden;transition:border-color 0.25s,box-shadow 0.25s,transform 0.25s;cursor:pointer}
.screenshot-card:hover{border-color:hsl(174 80% 46% / 0.38);box-shadow:0 12px 40px -10px hsl(174 80% 46% / 0.1),0 4px 16px -4px hsl(0 0% 0% / 0.4);transform:translateY(-2px)}
.screenshot-card.featured{grid-column:1 / -1}
.thumb-wrap{position:relative;overflow:hidden;background:var(--bg-2)}
.thumb-wrap img{width:100%;height:100%;object-fit:cover;display:block;transition:transform 0.4s cubic-bezier(0.4,0,0.2,1)}
.screenshot-card:hover img{transform:scale(1.04)}
.thumb-overlay{position:absolute;inset:0;background:linear-gradient(to top,hsl(240 10% 3.9% / 0.65) 0%,transparent 50%);opacity:0;transition:opacity 0.3s;display:flex;align-items:flex-end;justify-content:center;padding-bottom:1.25rem}
.screenshot-card:hover .thumb-overlay{opacity:1}
.zoom-hint{font-family:'JetBrains Mono',monospace;font-size:0.6875rem;font-weight:500;color:white;padding:5px 12px;border-radius:7px;background:hsl(0 0% 0% / 0.6);backdrop-filter:blur(10px);border:1px solid hsl(0 0% 100% / 0.1)}
.card-info{padding:0.875rem 1.125rem;display:flex;align-items:center;justify-content:space-between;gap:0.5rem}
.card-title{font-size:0.8125rem;font-weight:600;color:var(--fg)}
.card-badge{font-family:'JetBrains Mono',monospace;font-size:0.625rem;font-weight:600;color:var(--teal-light);padding:3px 8px;border-radius:5px;background:var(--teal-dim);border:1px solid hsl(174 80% 46% / 0.15);white-space:nowrap;flex-shrink:0}

/*** Empty state ***/
.empty-state{text-align:center;padding:4rem 2rem;color:var(--fg-muted);font-size:0.875rem}
.empty-state code{font-family:'JetBrains Mono',monospace;font-size:0.875em;background:var(--surface);padding:2px 6px;border-radius:4px;border:1px solid var(--border)}

/*** Lightbox ***/
.lightbox{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:hsl(240 10% 3.9% / 0.94);backdrop-filter:blur(24px);opacity:0;visibility:hidden;transition:opacity 0.3s,visibility 0.3s}
.lightbox.open{opacity:1;visibility:visible}
.lightbox-inner{position:relative;max-width:92vw;max-height:90vh;display:flex;flex-direction:column;align-items:center;gap:1rem;transform:scale(0.95);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1)}
.lightbox.open .lightbox-inner{transform:scale(1)}
.lightbox-inner img{max-width:100%;max-height:80vh;border-radius:12px;border:1px solid var(--border);box-shadow:0 32px 80px -20px hsl(0 0% 0% / 0.6);object-fit:contain}
.lightbox-caption{font-family:'Outfit',system-ui,sans-serif;font-size:0.9375rem;font-weight:500;color:var(--fg-muted)}
.lightbox-close{position:absolute;top:-3rem;right:0;width:38px;height:38px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2);color:var(--fg);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
.lightbox-close:hover{background:var(--surface-3);border-color:hsl(174 80% 46% / 0.3)}
.lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:1px solid var(--border);background:hsl(240 10% 9% / 0.85);backdrop-filter:blur(10px);color:var(--fg);font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
.lightbox-nav:hover{background:var(--surface-2);border-color:hsl(174 80% 46% / 0.3)}
.lightbox-nav.prev{left:-64px}
.lightbox-nav.next{right:-64px}

/*** Footer ***/
.site-footer{border-top:1px solid var(--border);padding:2rem;margin-top:2rem}
.footer-inner{max-width:1280px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem}
.footer-text{font-size:0.8125rem;color:var(--fg-muted)}
.footer-text a{color:var(--teal-light);text-decoration:none;transition:color 0.15s}
.footer-text a:hover{color:var(--fg)}
.footer-badge{font-family:'JetBrains Mono',monospace;font-size:0.6875rem;color:var(--fg-muted);padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface)}

/*** Animations ***/
.fade-up{opacity:0;transform:translateY(18px);transition:opacity 0.55s,transform 0.55s}
.fade-up.visible{opacity:1;transform:none}
.hero.fade-up{transform:none}

/*** Responsive ***/
@media(max-width:768px){
.hero-inner{padding:3rem 1.25rem 2.5rem}
.gallery-grid{grid-template-columns:1fr}
.stats-bar{grid-template-columns:1fr 1fr;padding:2rem 1.25rem}
.lightbox-nav.prev{left:0.5rem}
.lightbox-nav.next{right:0.5rem}
.section-header{flex-direction:column}
}
@media(max-width:480px){
.stats-bar{grid-template-columns:1fr}
.header-inner{padding:0 1rem}
.nav-link{padding:6px 8px;font-size:0.75rem}
.logo-badge{display:none}
}
  </style>
</head>
<body>

<header class="site-header">
  <div class="header-inner">
    <a href="#" class="logo">
      <div class="logo-mark">&#9889;</div>
      <span class="logo-text">Catalyst</span>
      <span class="logo-badge">PANEL</span>
    </a>
    <nav class="nav">
      <a href="#auth" class="nav-link">Auth</a>
      <a href="#user" class="nav-link">User</a>
      <a href="#admin" class="nav-link">Admin</a>
    </nav>
  </div>
</header>

<section class="hero fade-up">
  <div class="hero-glow"></div>
  <div class="hero-inner">
    <div class="hero-badge"><span class="hero-badge-dot"></span>Catalyst Panel</div>
    <h1>Game Server Management<br/><span class="accent">Made Simple</span></h1>
    <p>A modern, powerful control panel for managing game servers, nodes, and infrastructure — all from one beautiful interface.</p>
  </div>
</section>

<div class="stats-bar fade-up">
  <div class="stat-card">
    <div class="stat-icon teal">&#128737;</div>
    <div>
      <div class="stat-value">${totalCount}</div>
      <div class="stat-label">Screenshots</div>
    </div>
  </div>
  <div class="stat-card">
    <div class="stat-icon amber">&#128193;</div>
    <div>
      <div class="stat-value">${cats}</div>
      <div class="stat-label">Categories</div>
    </div>
  </div>
  <div class="stat-card">
    <div class="stat-icon rose">&#127912;</div>
    <div>
      <div class="stat-value">${authCount + userCount + adminCount}</div>
      <div class="stat-label">Pages covered</div>
    </div>
  </div>
</div>

${emptyState}

<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-text">
      <a href="#">Catalyst</a> &mdash; Open-source game server management panel
    </div>
    <div class="footer-badge">Built with Playwright &middot; ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
  </div>
</footer>

<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
  <div class="lightbox-inner">
    <button class="lightbox-close" id="lb-close" aria-label="Close">&#10005;</button>
    <button class="lightbox-nav prev" id="lb-prev" aria-label="Previous">&#139;</button>
    <button class="lightbox-nav next" id="lb-next" aria-label="Next">&#155;</button>
    <img id="lb-img" src="" alt="" />
    <div class="lightbox-caption" id="lb-caption"></div>
  </div>
</div>

<script>
(function() {
  var allImages = [
    ${allImagesJS}
  ];
  var currentIndex = 0;
  var lb = document.getElementById('lightbox');

  function openLightbox(idx) {
    currentIndex = idx;
    updateLightbox();
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
  }

  function updateLightbox() {
    var img = allImages[currentIndex];
    document.getElementById('lb-img').src = img.path;
    document.getElementById('lb-img').alt = img.title;
    document.getElementById('lb-caption').textContent = img.title;
  }

  document.addEventListener('click', function(e) {
    var card = e.target.closest('.screenshot-card');
    if (!card || e.target.closest('.lightbox')) return;
    var src = card.dataset.src;
    var idx = -1;
    for (var i = 0; i < allImages.length; i++) { if (allImages[i].path === src) { idx = i; break; } }
    if (idx !== -1) openLightbox(idx);
  });

  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  lb.addEventListener('click', function(e) { if (e.target === lb) closeLightbox(); });

  document.getElementById('lb-prev').addEventListener('click', function(e) {
    e.stopPropagation();
    currentIndex = (currentIndex - 1 + allImages.length) % allImages.length;
    updateLightbox();
  });

  document.getElementById('lb-next').addEventListener('click', function(e) {
    e.stopPropagation();
    currentIndex = (currentIndex + 1) % allImages.length;
    updateLightbox();
  });

  document.addEventListener('keydown', function(e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') { currentIndex = (currentIndex - 1 + allImages.length) % allImages.length; updateLightbox(); }
    if (e.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % allImages.length; updateLightbox(); }
  });

  // Scroll reveal
  var obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.07, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.fade-up').forEach(function(el) { obs.observe(el); });

  // Active nav
  var navLinks = document.querySelectorAll('.nav-link');
  var navObs = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        navLinks.forEach(function(l) { l.classList.remove('active'); });
        var link = document.querySelector('.nav-link[href="#' + entry.target.id + '"]');
        if (link) link.classList.add('active');
      }
    });
  }, { threshold: 0.2, rootMargin: '-80px 0px -55% 0px' });
  ['auth', 'user', 'admin'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) navObs.observe(el);
  });
})();
</script>
</body>
</html>`;

writeFileSync(OUT, html, 'utf8');

console.log('✅ Built screenshots-site/');
console.log(`   Total: ${totalCount} screenshots across ${cats} categories`);
console.log(`   Auth: ${authCount}  User: ${userCount}  Admin: ${adminCount}`);

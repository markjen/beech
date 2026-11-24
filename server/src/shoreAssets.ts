// Visual assets, stylesheet, icons, and client-side social snapshot studio
// for beechshore.com (used by server/src/shoreSite.ts).
//
// Everything is inline so pages stay single-request, fast, and usable without
// JavaScript; the small script progressively upgrades sharing with live canvas
// postcards (Postcard, Square, Story, Clean), clipboard image copy, PNG
// download, Web Share API with attached image files, and arrow-key walking.

export const WAVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#f5e4c8"/><path d="M1.2 13.5c4-3 7.2-3 10.4 0s6.2 3 9.4 0 5.8-3 9.8 0V9A15 15 0 0 0 1.2 13.5z" fill="#1e8da3"/><path d="M1 13.7c4-3 7.3-3 10.6 0s6.2 3 9.4 0 5.9-3 10 0" fill="none" stroke="#fffdf9" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="16" r="14.5" fill="none" stroke="rgba(31,47,61,.08)"/></svg>`;
export const FAVICON = `data:image/svg+xml,${encodeURIComponent(WAVE_SVG)}`;

export const ICONS = {
  share: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  download: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`,
  image: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor"/><path d="m21 15-4.5-4.5a1.5 1.5 0 0 0-2.1 0L7 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"/></svg>`,
  bsky: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.74 8.74 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" fill="currentColor"/></svg>`,
  threads: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.85 13.85 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32l-1.757-1.18c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65zm1.003-11.69a9.16 9.16 0 0 0-1.295.093c-1.855.107-2.762.927-2.707 1.938.051.946.974 1.638 2.244 1.57 1.646-.09 2.748-.978 3.003-3.307a10.45 10.45 0 0 0-1.245-.294z" fill="currentColor"/></svg>`,
  reddit: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M22 12a2.5 2.5 0 0 0-4.2-1.8c-1.5-1-3.5-1.7-5.8-1.8l1-4.6 3.2.7a1.8 1.8 0 1 0 .2-1.1l-3.8-.8a.6.6 0 0 0-.7.4L10.8 8.4c-2.3.1-4.4.8-5.9 1.8a2.5 2.5 0 1 0-2.8 4 4.5 4.5 0 0 0-.1 1c0 3.7 4.5 6.8 10 6.8s10-3.1 10-6.8c0-.3 0-.7-.1-1A2.5 2.5 0 0 0 22 12zm-13.5 1.5a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm6.9 4.5c-.9.9-2.4 1.2-3.4 1.2s-2.5-.3-3.4-1.2a.5.5 0 0 1 .7-.7c.6.6 1.7.9 2.7.9s2.1-.3 2.7-.9a.5.5 0 0 1 .7.7zm-.4-1.7a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8z" fill="currentColor"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2a9.9 9.9 0 0 0-8.6 14.9L2 22l5.3-1.4A10 10 0 1 0 12 2zm5.4 14.1c-.2.6-1.3 1.2-1.8 1.3-.5.1-1.1.1-1.8-.1a14 14 0 0 1-5.8-4c-1.1-1.2-1.8-2.6-2-3.1-.2-.5 0-1.1.3-1.4l.7-.8c.2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.4l.8 1.9c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.1-.3.3-.1.6a8.6 8.6 0 0 0 3.7 3.2c.3.1.5.1.7-.1l.8-.9c.2-.2.4-.2.6-.1l1.9.9c.3.1.4.2.5.4 0 .2 0 .9-.2 1.5z" fill="currentColor"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14 13.5h2.5l1-4H14v-2c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4v-8.5z" fill="currentColor"/></svg>`,
  sms: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 20.5l1.6-4.7A8.5 8.5 0 1 1 21 11.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  compass: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4z" fill="currentColor"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 1 1 13 0c0 5.2-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.2" fill="currentColor"/></svg>`,
};

// Note: `.grid{...}`, `.strip{...}`, `.top{...}`, `.chips{...}` keep their
// exact selector spacing and gap values (`gap:0` on `.grid` and `.strip` so
// beach tiles touch edge to edge like a continuous shore; `gap:16px` on `.top`
// and `gap:8px` on `.chips`).
export const SHORE_CSS = `
:root{
  --sand:#f5e4c8;
  --sand2:#fbf6ee;
  --ink:#1f2f3d;
  --ink2:#5b6d7c;
  --sea:#1e8da3;
  --sea-hi:#167588;
  --sea-soft:rgba(30,141,163,.11);
  --card:#fffdf9;
  --card2:#f4ecdf;
  --line:#e8dcc8;
  --line2:#d7c6aa;
  --accent:#d95348;
  --gold:#c58410;
  --up:#238752;
  --sh-sm:0 1px 2px rgba(31,47,61,.05),0 6px 18px rgba(31,47,61,.045);
  --sh-md:0 4px 14px rgba(31,47,61,.06),0 18px 42px rgba(31,47,61,.06);
  --sh-lg:0 12px 32px rgba(31,47,61,.1),0 26px 60px rgba(31,47,61,.08);
  --font-sans:"Plus Jakarta Sans",ui-rounded,"SF Pro Rounded",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-display:"Fraunces",Georgia,"Times New Roman",serif;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){
  :root{
    --sand:#2c2721;
    --sand2:#161412;
    --ink:#f3ece1;
    --ink2:#aba08f;
    --sea:#4ec2d6;
    --sea-hi:#69cfe0;
    --sea-soft:rgba(78,194,214,.15);
    --card:#211e1a;
    --card2:#1a1714;
    --line:#342e27;
    --line2:#484036;
    --gold:#efb93d;
    --up:#52c484;
    --sh-sm:0 1px 2px rgba(0,0,0,.22),0 8px 20px rgba(0,0,0,.2);
    --sh-md:0 6px 18px rgba(0,0,0,.28),0 20px 44px rgba(0,0,0,.25);
    --sh-lg:0 14px 36px rgba(0,0,0,.38),0 28px 64px rgba(0,0,0,.32);
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{
  margin:0;
  min-height:100dvh;
  background:var(--sand2);
  background-image:radial-gradient(ellipse 95% 420px at 50% -110px,color-mix(in srgb,var(--sea) 11%,transparent),transparent 72%);
  color:var(--ink);
  font:15.5px/1.55 var(--font-sans);
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
a{color:var(--sea);text-underline-offset:3px}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--sea);outline-offset:2px}
img{max-width:100%;height:auto;display:block}

/* header */
.top-wrap{
  position:sticky;top:0;z-index:20;
  background:color-mix(in srgb,var(--sand2) 84%,transparent);
  backdrop-filter:blur(14px) saturate(140%);
  -webkit-backdrop-filter:blur(14px) saturate(140%);
  border-bottom:1px solid var(--line);
}
.top{display:flex;align-items:center;gap:16px;max-width:1220px;margin:0 auto;padding:11px max(20px,env(safe-area-inset-left))}
.brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink);font-size:19px;font-weight:700;letter-spacing:-.025em;flex-shrink:0}
.brand svg{flex-shrink:0;transition:transform .25s ease}
.brand:hover svg{transform:rotate(-8deg) scale(1.04)}
.brand b{color:var(--sea);font-weight:800}
.top nav{display:flex;align-items:center;gap:4px;flex:1;overflow-x:auto;scrollbar-width:none}
.top nav::-webkit-scrollbar{display:none}
.top nav a{
  color:var(--ink2);text-decoration:none;white-space:nowrap;font-size:14.5px;font-weight:550;
  padding:6px 12px;border-radius:999px;transition:background .15s,color .15s;
}
.top nav a:hover{color:var(--ink);background:var(--sea-soft)}
.top nav a[aria-current="page"]{color:var(--ink);background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
.find{
  position:relative;display:flex;align-items:center;
  background:var(--card);border:1px solid var(--line);border-radius:999px;
  padding:0 10px 0 12px;height:36px;width:190px;flex-shrink:0;
  transition:border-color .15s,box-shadow .15s,width .2s;
}
.find:focus-within{border-color:var(--sea);box-shadow:0 0 0 3px var(--sea-soft);width:228px}
.find svg{color:var(--ink2);flex-shrink:0;margin-right:7px}
.find input{
  border:0;background:transparent;color:var(--ink);font:inherit;font-size:13.5px;
  width:100%;min-width:0;padding:0;outline:none;
}
.find input::placeholder{color:var(--ink2);opacity:.85}
.mob-nav{
  display:none;gap:6px;overflow-x:auto;scrollbar-width:none;
  padding:0 max(16px,env(safe-area-inset-left)) 10px;max-width:1220px;margin:0 auto;
}
.mob-nav::-webkit-scrollbar{display:none}
.mob-nav a{
  color:var(--ink2);text-decoration:none;white-space:nowrap;font-size:13.5px;font-weight:550;
  padding:5px 12px;border-radius:999px;background:var(--card);border:1px solid var(--line);
}
.mob-nav a[aria-current="page"]{color:var(--card);background:var(--ink);border-color:var(--ink)}

/* layout & type */
main{max-width:1220px;margin:0 auto;padding:0 20px 48px}
section{margin:40px 0}
h1{
  font-family:var(--font-display);font-weight:600;
  font-variation-settings:"SOFT" 55,"WONK" 0;
  font-size:clamp(30px,4.8vw,48px);line-height:1.06;margin:0 0 10px;letter-spacing:-.028em;
}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:0 0 14px}
h2{font-size:21px;font-weight:720;letter-spacing:-.02em;margin:0;display:flex;align-items:baseline;gap:12px}
h2 a,.see-all{
  font-size:14px;font-weight:600;text-decoration:none;color:var(--sea);
  display:inline-flex;align-items:center;gap:4px;transition:transform .15s,color .15s;
}
h2 a:hover,.see-all:hover{color:var(--sea-hi);transform:translateX(2px)}

/* buttons & chips */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  background:var(--sea);color:#fff;border:0;border-radius:999px;
  padding:11px 20px;font:inherit;font-size:15px;font-weight:650;
  text-decoration:none;cursor:pointer;white-space:nowrap;
  box-shadow:0 2px 8px color-mix(in srgb,var(--sea) 28%,transparent);
  transition:transform .15s ease,background .15s ease,box-shadow .15s ease;
}
.btn:hover{background:var(--sea-hi);transform:translateY(-1px);box-shadow:0 6px 16px color-mix(in srgb,var(--sea) 32%,transparent)}
.btn:active{transform:translateY(0)}
.btn.ghost{
  background:var(--card);color:var(--ink);
  box-shadow:inset 0 0 0 1.5px var(--line2);
}
.btn.ghost:hover{background:var(--card2);box-shadow:inset 0 0 0 1.5px var(--ink2);color:var(--ink)}
.btn.small{padding:8px 15px;font-size:13.5px}
.btn.big{padding:13px 24px;font-size:16px}
.chip{
  display:inline-flex;align-items:center;gap:7px;
  background:var(--card);color:var(--ink);border:1px solid var(--line);
  border-radius:999px;padding:8px 14px;font:inherit;font-size:13.5px;font-weight:550;
  text-decoration:none;cursor:pointer;
  transition:border-color .15s,background .15s,transform .15s,box-shadow .15s;
}
.chip:hover{border-color:var(--line2);background:var(--card2);transform:translateY(-1px);box-shadow:var(--sh-sm)}
.chip:active{transform:translateY(0)}
.chip span{color:var(--ink2);font-weight:500;font-variant-numeric:tabular-nums}
.chip .dot-swatch{
  width:10px;height:10px;border-radius:50%;background:var(--dot,var(--sand));
  box-shadow:inset 0 0 0 1px rgba(31,47,61,.18);flex-shrink:0;
}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.linkish{background:none;border:0;padding:0;font:inherit;color:var(--sea);text-decoration:underline;cursor:pointer}

/* hero */
.hero{
  position:relative;border-radius:26px;overflow:hidden;margin-top:22px;
  background:var(--sea);box-shadow:var(--sh-lg);border:1px solid color-mix(in srgb,var(--ink) 8%,transparent);
}
.hero-img{width:100%;aspect-ratio:1200/560;object-fit:cover;display:block}
.hero-badge{
  position:absolute;top:16px;left:16px;z-index:2;
  display:inline-flex;align-items:center;gap:7px;
  padding:6px 13px;border-radius:999px;text-decoration:none;
  background:rgba(20,34,44,.62);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:#fff;font-size:13px;font-weight:550;border:1px solid rgba(255,255,255,.18);
  transition:background .15s,transform .15s;
}
.hero-badge:hover{background:rgba(20,34,44,.78);transform:translateY(-1px)}
.hero-text{
  position:absolute;inset:auto 0 0 0;padding:48px 32px 30px;
  background:linear-gradient(180deg,transparent 0%,rgba(16,32,42,.38) 38%,rgba(14,28,38,.82) 100%);
  color:#fff;
}
.hero-text h1{color:#fff;text-shadow:0 2px 18px rgba(0,0,0,.22)}
.hero-text p{max-width:600px;margin:0 0 18px;font-size:16.5px;color:rgba(255,255,255,.92);line-height:1.5}
.hero .btn.ghost{
  background:rgba(255,255,255,.14);color:#fff;backdrop-filter:blur(8px);
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.65);
}
.hero .btn.ghost:hover{background:rgba(255,255,255,.24);color:#fff;box-shadow:inset 0 0 0 1.5px #fff}
.cta{display:flex;flex-wrap:wrap;gap:10px}

/* edge-to-edge beach mosaic grid */
.grid-wrap{padding:1px 0 0 1px}
.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0}
.card{min-width:0;margin:-1px 0 0 -1px}
.card a{
  display:flex;flex-direction:column;height:100%;
  background:var(--card);border-radius:0;overflow:hidden;
  text-decoration:none;color:var(--ink);
  border:1px solid var(--line);
  transition:background .15s,border-color .15s;
}
.card a:hover{background:var(--card2)}
.thumb{position:relative;overflow:hidden;background:var(--sand);aspect-ratio:480/300}
.card img{width:100%;height:100%;object-fit:cover;transition:transform .35s cubic-bezier(.22,1,.36,1)}
.card a:hover img{transform:scale(1.045)}
.info{display:flex;flex-direction:column;padding:12px 15px 14px;gap:3px;flex:1}
.info .t{font-weight:700;font-size:15.5px;letter-spacing:-.015em;display:flex;align-items:center;gap:7px;line-height:1.25}
.info .s{color:var(--ink2);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13px;color:var(--ink2);margin-top:4px;font-variant-numeric:tabular-nums}
.stars{color:var(--gold);font-weight:680}
.up{color:var(--up);font-weight:600}
.rank-badge{
  position:absolute;top:10px;left:10px;z-index:2;
  display:inline-grid;place-items:center;min-width:26px;height:26px;padding:0 7px;
  border-radius:999px;font-size:12.5px;font-weight:750;font-variant-numeric:tabular-nums;
  background:rgba(20,34,44,.72);color:#fff;backdrop-filter:blur(6px);
  box-shadow:0 2px 8px rgba(0,0,0,.2);
}
.rank-badge.r1{background:#f2c144;color:#4a3500}
.rank-badge.r2{background:#e2e7ec;color:#283440}
.rank-badge.r3{background:#dfa06f;color:#4a250a}

/* list & place headers */
.head{margin-top:28px;margin-bottom:22px}
.head p{color:var(--ink2);max-width:640px;margin:0 0 16px;font-size:16px}
.tabs{display:inline-flex;gap:4px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px}
.tabs a{padding:7px 15px;border-radius:999px;text-decoration:none;color:var(--ink2);font-size:14px;font-weight:600;transition:background .15s,color .15s}
.tabs a:hover{color:var(--ink)}
.tabs a[aria-current]{background:var(--ink);color:var(--sand2)}
.pager{display:flex;gap:10px;justify-content:center;margin-top:24px}
.empty{color:var(--ink2);background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px;text-align:center}

/* single beach showcase */
.beach{margin-top:22px}
.pic{
  position:relative;border-radius:24px;overflow:hidden;
  background:var(--sea);box-shadow:var(--sh-lg);
  border:1px solid color-mix(in srgb,var(--ink) 8%,transparent);
}
.pic img{width:100%;aspect-ratio:1200/630;object-fit:cover}
.pic-pills{
  position:absolute;top:14px;left:14px;right:14px;
  display:flex;justify-content:space-between;align-items:center;gap:10px;pointer-events:none;
}
.pic-pill{
  pointer-events:auto;display:inline-flex;align-items:center;gap:6px;
  padding:6px 12px;border-radius:999px;text-decoration:none;border:1px solid rgba(255,255,255,.22);
  background:rgba(20,34,44,.62);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:#fff;font-size:13px;font-weight:600;cursor:pointer;
  transition:background .15s,transform .15s;
}
.pic-pill:hover{background:rgba(20,34,44,.8);transform:translateY(-1px)}
.pic-pill.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;font-size:12.5px}
.view-toggle{
  position:absolute;left:50%;bottom:14px;transform:translateX(-50%);
  display:flex;gap:2px;padding:3px;border-radius:999px;
  background:rgba(20,34,44,.62);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border:1px solid rgba(255,255,255,.22);
}
.view-toggle button{border:0;background:transparent;color:#fff;font:600 12.5px 'Plus Jakarta Sans',system-ui,sans-serif;padding:5px 12px;border-radius:999px;cursor:pointer;opacity:.85}
.view-toggle button[aria-pressed="true"]{background:#fbf6ee;color:#1f2f3d;opacity:1}
.walk{
  position:absolute;top:50%;transform:translateY(-50%);
  width:48px;height:48px;border-radius:999px;display:grid;place-items:center;
  background:color-mix(in srgb,var(--card) 88%,transparent);backdrop-filter:blur(8px);
  color:var(--ink);font-size:30px;line-height:1;text-decoration:none;
  border:1px solid color-mix(in srgb,var(--ink) 10%,transparent);
  box-shadow:0 4px 16px rgba(0,0,0,.18);transition:transform .15s,background .15s;
}
.walk:hover{background:var(--card);transform:translateY(-50%) scale(1.06)}
.walk.left{left:14px}.walk.right{right:14px}

.about{
  display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;
  gap:20px 32px;margin:22px 0 0;padding-bottom:24px;border-bottom:1px solid var(--line);
}
.about .by{margin:0;color:var(--ink2);font-size:16px}
.about .by a{font-weight:600;text-decoration:none}
.about .by a:hover{text-decoration:underline}
.about .m{margin:10px 0 0;font-size:14.5px;gap:14px}
.about .nb{margin:10px 0 0;color:var(--ink2);font-size:14.5px}
.about .nb a{font-weight:600;text-decoration:none}
.about .nb a:hover{text-decoration:underline}
.actions{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.action-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}
.hint{color:var(--ink2);font-size:13.5px;margin:0}

/* social share & snapshot studio */
.studio{
  margin-top:26px;background:var(--card);border:1px solid var(--line);
  border-radius:24px;padding:24px;box-shadow:var(--sh-md);
}
.studio-head{
  display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
  gap:12px;margin-bottom:20px;
}
.studio-head h2{font-size:19px}
.seg{
  display:inline-flex;gap:3px;padding:4px;border-radius:999px;
  background:var(--card2);border:1px solid var(--line);
}
.seg button{
  border:0;background:transparent;color:var(--ink2);font:inherit;font-size:13px;font-weight:650;
  padding:6px 13px;border-radius:999px;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s;
}
.seg button:hover{color:var(--ink)}
.seg button[aria-pressed="true"]{background:var(--card);color:var(--ink);box-shadow:0 1px 4px rgba(31,47,61,.12)}
.studio-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:24px;align-items:start}
.studio-grid>*{min-width:0}
.stage{
  background:var(--card2);border:1px solid var(--line);border-radius:18px;
  padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px;overflow:hidden;
}
.stage-frame{
  width:100%;display:flex;justify-content:center;align-items:center;
  min-height:220px;
}
.snap-canvas,.snap-fallback{
  max-width:100%;max-height:380px;width:auto;height:auto;
  border-radius:12px;box-shadow:0 8px 26px rgba(31,47,61,.14);
}
.snap-canvas{display:none}
.stage.ready .snap-canvas{display:block}
.stage.ready .snap-fallback{display:none}
.stage-meta{font-size:12.5px;color:var(--ink2);text-align:center}

.studio-controls{display:flex;flex-direction:column;gap:16px}
.snap-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.snap-actions .btn-primary-snap{grid-column:1 / -1}
.field-group{display:flex;flex-direction:column;gap:6px}
.field-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink2)}
.copy-bar{
  display:flex;align-items:center;gap:8px;
  background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:6px 6px 6px 13px;
}
.copy-bar code{
  flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:var(--ink);
}
.copy-bar input{
  flex:1;min-width:0;border:0;background:transparent;color:var(--ink);
  font:inherit;font-size:14px;outline:none;padding:4px 0;
}
.copy-bar .chip{padding:6px 12px;font-size:13px;background:var(--card)}
.share{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.share .chip{padding:8px 13px;font-size:13.5px}
.share-note{font-size:12.5px;color:var(--ink2);margin:0;line-height:1.45}

/* along the shore continuous strip */
.strip-wrap{
  border-radius:18px;overflow:hidden;border:1px solid var(--line);
  background:var(--card);box-shadow:var(--sh-sm);
}
.strip{list-style:none;margin:0;padding:0;display:flex;gap:0;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:thin}
.strip li{flex:1 0 185px;scroll-snap-align:center;position:relative}
.strip a,.strip .here-inner{
  display:flex;flex-direction:column;height:100%;text-decoration:none;color:var(--ink);
  box-shadow:inset -1px 0 0 var(--line);transition:background .15s;
}
.strip a:hover{background:var(--card2)}
.strip .sthumb{position:relative;overflow:hidden;aspect-ratio:480/300;background:var(--sand)}
.strip img{width:100%;height:100%;object-fit:cover;border-radius:0;transition:transform .3s ease}
.strip a:hover img{transform:scale(1.045)}
.strip .slabel{
  padding:9px 12px 11px;font-size:13.5px;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  display:flex;align-items:center;justify-content:space-between;gap:6px;
}
.strip .linked-dot{
  font-size:11px;font-weight:650;color:var(--sea);background:var(--sea-soft);
  padding:2px 7px;border-radius:999px;flex-shrink:0;
}
.strip .here{background:color-mix(in srgb,var(--sea) 8%,var(--card))}
.strip .here .sthumb::after{
  content:"You are here";position:absolute;bottom:8px;left:8px;
  background:var(--sea);color:#fff;font-size:11px;font-weight:700;
  padding:3px 9px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.22);
}
.strip .here .here-inner{box-shadow:inset -1px 0 0 var(--line),inset 0 -3px 0 var(--sea)}
.strip .here .slabel{color:var(--sea);font-weight:700}

/* callout boxes & footer */
.make,.sharebox{
  background:var(--card);border:1px solid var(--line);border-radius:22px;padding:26px 28px;
  box-shadow:var(--sh-sm);
}
.make{
  display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px 28px;
  background:linear-gradient(135deg,var(--card) 0%,color-mix(in srgb,var(--sand) 42%,var(--card)) 100%);
}
.make p{max-width:580px;color:var(--ink2);margin:6px 0 0}
.sharebox{display:flex;flex-direction:column;gap:14px}
.sharebox p{color:var(--ink2);margin:0;max-width:600px}

footer{
  max-width:1220px;margin:0 auto;padding:28px 20px 44px;
  color:var(--ink2);font-size:14px;border-top:1px solid var(--line);
  display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px 32px;
}
footer p{margin:0;max-width:560px}
footer .flinks{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
footer .flinks a{text-decoration:none;color:var(--ink2);font-weight:550}
footer .flinks a:hover{color:var(--sea)}

/* find form */
.find-big{display:flex;gap:8px;max-width:460px;margin-top:14px}
.find-big input{
  flex:1;min-width:0;border:1px solid var(--line2);background:var(--card);color:var(--ink);
  border-radius:999px;padding:11px 18px;font:inherit;font-size:15px;
}
.find-big input:focus{outline:none;border-color:var(--sea);box-shadow:0 0 0 3px var(--sea-soft)}

@media (hover:none){.hint.keys{display:none}}
.toast{
  position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);z-index:40;
  background:var(--ink);color:var(--sand2);padding:10px 18px;border-radius:999px;
  opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;font-size:14.5px;font-weight:600;
  box-shadow:0 10px 28px rgba(0,0,0,.22);
}
.toast.on{opacity:1;transform:translate(-50%,0)}

@media (max-width:900px){
  .studio-grid{grid-template-columns:1fr}
  .actions{align-items:flex-start}
  .action-row{justify-content:flex-start}
}
@media (max-width:760px){
  .top{gap:16px;padding:10px 16px;flex-wrap:wrap}
  .top nav{display:none}
  .brand{margin-right:auto}
  .find{order:3;flex:1 0 100%;width:100%;height:38px}
  .find:focus-within{width:100%}
  .mob-nav{display:flex}
  main{padding:0 14px 40px}
  section{margin:30px 0}
}
@media (max-width:640px){
  .hero-img{aspect-ratio:4/3}
  .hero-text{position:static;background:var(--card);color:var(--ink);padding:20px 18px 22px}
  .hero-text h1{color:var(--ink);text-shadow:none}
  .hero-text p{color:var(--ink2);font-size:15.5px}
  .hero .btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--line2)}
  .hero{background:var(--card);border-radius:20px}
  .pic{border-radius:18px}
  .walk{width:40px;height:40px;font-size:24px}
  .walk.left{left:8px}.walk.right{right:8px}
  .about .actions{width:100%}
  .action-row{width:100%}
  .action-row .btn{flex:1}
  .studio{padding:18px 16px;border-radius:20px}
  .snap-actions{grid-template-columns:1fr 1fr}
  .snap-actions .btn{padding:10px 10px;font-size:13.5px;min-width:0}
  .make,.sharebox{padding:20px 18px}
}
`;

// Client-side progressive enhancement:
// 1. Copy link / code / post text with toast confirmation.
// 2. Native share (Web Share API) for regular pages and footer buttons.
// 3. Snapshot Postcard Studio on beach pages (`#share`): renders the beach's
//    server-drawn PNG into 4 crisp social formats (Postcard 1200x630, Square
//    1080x1080, Story 1080x1920, Clean 1200x630), supports Web Share with the
//    PNG file attached, Clipboard PNG copy, PNG download, and live caption sync.
// 4. Centering the "Along the shore" strip on the current beach & ←/→ walking.
export const SHORE_SCRIPT = `(()=>{
const toast=document.querySelector('.toast');let timer;
const say=m=>{if(!toast)return;toast.textContent=m;toast.classList.add('on');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('on'),2400)};
const copyText=async(u,msg='Link copied')=>{try{await navigator.clipboard.writeText(u);say(msg)}catch{window.prompt('Copy this',u)}};

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-share],[data-copy]');
  if(!b)return;
  if(b.dataset.copy){copyText(b.dataset.copy,b.dataset.copied||'Link copied');return}
  const d={title:b.dataset.title,text:b.dataset.text,url:b.dataset.url};
  if(navigator.share){try{await navigator.share(d);return}catch(x){if(x&&x.name==='AbortError')return}}
  copyText(d.url);
});

const st=document.querySelector('.strip'),hr=st&&st.querySelector('.here');
if(hr)st.scrollLeft=hr.offsetLeft-st.offsetLeft-(st.clientWidth-hr.clientWidth)/2;

document.addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey||/input|textarea/i.test(e.target.tagName))return;
  const a=document.querySelector('[data-key="'+e.key+'"]');
  if(a)location.href=a.href;
});

// Beach picture view: Flat / 3D / From the sea (only on beach pages)
const vt=document.querySelector('[data-view-toggle]');
if(vt){
  const pic=vt.closest('.pic');const img=pic&&pic.querySelector('img');
  const views={card:vt.dataset.card,iso:vt.dataset.iso,ocean:vt.dataset.ocean};
  const alts={card:'altCard',iso:'altIso',ocean:'altOcean'};
  vt.addEventListener('click',e=>{
    const b=e.target.closest('[data-view]');if(!b||!img)return;
    const view=b.dataset.view;if(!views[view])return;
    img.src=views[view];
    img.alt=img.dataset[alts[view]]||img.alt;
    vt.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  });
}

// Social Snapshot Studio (only on beach pages)
const studio=document.getElementById('share');
if(!studio)return;
const cfg={
  img:studio.dataset.img,
  title:studio.dataset.title||'',
  owner:studio.dataset.owner||'',
  place:studio.dataset.place||'',
  stars:Number(studio.dataset.stars||0),
  code:studio.dataset.code||'',
  url:studio.dataset.url||location.href,
  shortUrl:(studio.dataset.url||'').replace(/^https?:\\/\\//,''),
  slug:studio.dataset.slug||'beach',
};
const stage=studio.querySelector('.stage');
const canvas=studio.querySelector('.snap-canvas');
const metaEl=studio.querySelector('.stage-meta');
const capInput=studio.querySelector('[data-caption]');
const FORMATS={
  postcard:{w:1200,h:630,label:'1200 × 630 · Ready for X, Discord, Bluesky, Reddit, Facebook'},
  square:{w:1080,h:1080,label:'1080 × 1080 · Ready for Instagram feed & Threads'},
  story:{w:1080,h:1920,label:'1080 × 1920 · Ready for Instagram Stories, TikTok & Status'},
  clean:{w:1200,h:630,label:'1200 × 630 · Clean beach snapshot, no text'},
};
let fmt='postcard';
let pic=null;

const rrect=(ctx,x,y,w,h,r)=>{
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
};
const drawCover=(ctx,im,x,y,w,h)=>{
  const ir=im.naturalWidth/im.naturalHeight,tr=w/h;
  let sx=0,sy=0,sw=im.naturalWidth,sh=im.naturalHeight;
  if(ir>tr){sw=sh*tr;sx=(im.naturalWidth-sw)/2}else{sh=sw/tr;sy=(im.naturalHeight-sh)/2}
  ctx.drawImage(im,sx,sy,sw,sh,x,y,w,h);
};
const drawWave=(ctx,cx,cy,r)=>{
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
  ctx.fillStyle='#f5e4c8';ctx.fillRect(cx-r,cy-r,r*2,r*2);
  ctx.fillStyle='#1e8da3';ctx.beginPath();ctx.moveTo(cx-r,cy-r);ctx.lineTo(cx+r,cy-r);ctx.lineTo(cx+r,cy-r*.1);
  ctx.bezierCurveTo(cx+r*.45,cy-r*.45,cx+r*.15,cy+r*.25,cx-r*.3,cy-r*.12);
  ctx.bezierCurveTo(cx-r*.65,cy-r*.4,cx-r*.85,cy-r*.05,cx-r,cy-r*.12);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#fffdf9';ctx.lineWidth=Math.max(1.5,r*.11);ctx.lineCap='round';ctx.beginPath();
  ctx.moveTo(cx+r,cy-r*.1);ctx.bezierCurveTo(cx+r*.45,cy-r*.45,cx+r*.15,cy+r*.25,cx-r*.3,cy-r*.12);
  ctx.bezierCurveTo(cx-r*.65,cy-r*.4,cx-r*.85,cy-r*.05,cx-r,cy-r*.12);ctx.stroke();
  ctx.restore();
};
const fitText=(ctx,text,maxW,startPx,minPx,weight,fam)=>{
  let px=startPx;
  while(px>minPx){ctx.font=weight+' '+px+'px '+fam;if(ctx.measureText(text).width<=maxW)break;px-=2}
  let out=text;
  if(ctx.measureText(out).width>maxW){while(out.length>3&&ctx.measureText(out+'…').width>maxW)out=out.slice(0,-1);out+='…'}
  return{px,text:out};
};

const render=()=>{
  if(!pic||!canvas)return;
  const F=FORMATS[fmt];
  canvas.width=F.w;canvas.height=F.h;
  const ctx=canvas.getContext('2d');
  const sans='"Plus Jakarta Sans",system-ui,-apple-system,sans-serif';
  const disp='"Fraunces",Georgia,serif';
  if(fmt==='clean'){
    drawCover(ctx,pic,0,0,F.w,F.h);
  }else if(fmt==='postcard'){
    ctx.fillStyle='#fbf6ee';ctx.fillRect(0,0,F.w,F.h);
    const pad=22,imgH=476;
    ctx.save();rrect(ctx,pad,pad,F.w-pad*2,imgH,20);ctx.clip();
    drawCover(ctx,pic,pad,pad,F.w-pad*2,imgH);ctx.restore();
    ctx.strokeStyle='rgba(31,47,61,.1)';ctx.lineWidth=2;rrect(ctx,pad,pad,F.w-pad*2,imgH,20);ctx.stroke();
    if(cfg.place){
      ctx.font='600 20px '+sans;
      const pw=ctx.measureText(cfg.place).width+34;
      ctx.fillStyle='rgba(20,34,44,.66)';rrect(ctx,pad+18,pad+18,pw,40,20);ctx.fill();
      ctx.fillStyle='#fffdf9';ctx.textBaseline='middle';ctx.fillText(cfg.place,pad+35,pad+39);
    }
    const fy=pad+imgH+18;
    const rightText=cfg.shortUrl||'beechshore.com/'+cfg.code;
    ctx.font='700 22px '+sans;
    const rw=ctx.measureText(rightText).width+62;
    ctx.fillStyle='rgba(30,141,163,.12)';rrect(ctx,F.w-pad-rw,fy+24,rw,48,24);ctx.fill();
    drawWave(ctx,F.w-pad-rw+26,fy+48,14);
    ctx.fillStyle='#167588';ctx.textBaseline='middle';ctx.fillText(rightText,F.w-pad-rw+48,fy+49);
    const maxTitleW=F.w-pad*2-rw-28;
    const ft=fitText(ctx,cfg.title,maxTitleW,42,26,'600',disp);
    ctx.font='600 '+ft.px+'px '+disp;ctx.fillStyle='#1f2f3d';ctx.textBaseline='top';
    ctx.fillText(ft.text,pad+6,fy+12);
    const subParts=[];
    if(cfg.owner&&!cfg.title.toLowerCase().includes(cfg.owner.toLowerCase()))subParts.push('by '+cfg.owner);
    if(cfg.stars>0)subParts.push('★ '+cfg.stars+(cfg.stars===1?' star':' stars'));
    subParts.push('Visit in 3D on beech');
    ctx.font='600 20px '+sans;ctx.fillStyle='#5b6d7c';
    ctx.fillText(subParts.join(' · '),pad+6,fy+64);
  }else if(fmt==='square'){
    const g=ctx.createLinearGradient(0,0,0,F.h);g.addColorStop(0,'#eaf4f6');g.addColorStop(.32,'#fbf6ee');g.addColorStop(1,'#f5e4c8');
    ctx.fillStyle=g;ctx.fillRect(0,0,F.w,F.h);
    const pad=48,cardX=pad,cardY=pad,cardW=F.w-pad*2,cardH=F.h-pad*2;
    ctx.save();ctx.shadowColor='rgba(31,47,61,.14)';ctx.shadowBlur=40;ctx.shadowOffsetY=16;
    ctx.fillStyle='#fffdf9';rrect(ctx,cardX,cardY,cardW,cardH,34);ctx.fill();ctx.restore();
    ctx.strokeStyle='#e8dcc8';ctx.lineWidth=2;rrect(ctx,cardX,cardY,cardW,cardH,34);ctx.stroke();
    const ip=26,ix=cardX+ip,iy=cardY+ip,iw=cardW-ip*2,ih=640;
    ctx.save();rrect(ctx,ix,iy,iw,ih,24);ctx.clip();drawCover(ctx,pic,ix,iy,iw,ih);ctx.restore();
    if(cfg.place){
      ctx.font='600 24px '+sans;const pw=ctx.measureText(cfg.place).width+40;
      ctx.fillStyle='rgba(20,34,44,.66)';rrect(ctx,ix+20,iy+20,pw,48,24);ctx.fill();
      ctx.fillStyle='#fffdf9';ctx.textBaseline='middle';ctx.fillText(cfg.place,ix+40,iy+45);
    }
    const ty=iy+ih+36;
    const ft=fitText(ctx,cfg.title,iw-16,54,32,'600',disp);
    ctx.font='600 '+ft.px+'px '+disp;ctx.fillStyle='#1f2f3d';ctx.textBaseline='top';
    ctx.fillText(ft.text,ix+6,ty);
    const sub=[];
    if(cfg.owner&&!cfg.title.toLowerCase().includes(cfg.owner.toLowerCase()))sub.push('by '+cfg.owner);
    if(cfg.stars>0)sub.push('★ '+cfg.stars+(cfg.stars===1?' star':' stars'));
    if(!sub.length)sub.push('Built in beech');
    ctx.font='600 25px '+sans;ctx.fillStyle='#5b6d7c';ctx.fillText(sub.join(' · '),ix+6,ty+ft.px+16);
    const by=cardY+cardH-76;
    drawWave(ctx,ix+26,by+18,18);
    ctx.font='700 26px '+sans;ctx.fillStyle='#167588';ctx.textBaseline='middle';
    ctx.fillText(cfg.shortUrl||'beechshore.com/'+cfg.code,ix+58,by+19);
    ctx.font='600 22px '+sans;ctx.fillStyle='#5b6d7c';ctx.textAlign='right';
    ctx.fillText('Visit in 3D →',ix+iw-6,by+19);ctx.textAlign='left';
  }else if(fmt==='story'){
    const g=ctx.createLinearGradient(0,0,0,F.h);g.addColorStop(0,'#d9eef2');g.addColorStop(.38,'#fbf6ee');g.addColorStop(1,'#f2dec0');
    ctx.fillStyle=g;ctx.fillRect(0,0,F.w,F.h);
    drawWave(ctx,F.w/2-116,164,26);
    ctx.font='700 40px '+sans;ctx.fillStyle='#1f2f3d';ctx.textBaseline='middle';
    ctx.fillText('beech',F.w/2-74,166);
    const bw=ctx.measureText('beech').width;
    ctx.fillStyle='#1e8da3';ctx.fillText('shore',F.w/2-74+bw,166);
    const cx=64,cy=260,cw=F.w-128,ch=1280;
    ctx.save();ctx.shadowColor='rgba(31,47,61,.16)';ctx.shadowBlur=56;ctx.shadowOffsetY=24;
    ctx.fillStyle='#fffdf9';rrect(ctx,cx,cy,cw,ch,44);ctx.fill();ctx.restore();
    ctx.strokeStyle='#e8dcc8';ctx.lineWidth=2;rrect(ctx,cx,cy,cw,ch,44);ctx.stroke();
    const ip=34,ix=cx+ip,iy=cy+ip,iw=cw-ip*2,ih=900;
    ctx.save();rrect(ctx,ix,iy,iw,ih,30);ctx.clip();drawCover(ctx,pic,ix,iy,iw,ih);ctx.restore();
    if(cfg.place){
      ctx.font='600 28px '+sans;const pw=ctx.measureText(cfg.place).width+48;
      ctx.fillStyle='rgba(20,34,44,.68)';rrect(ctx,ix+24,iy+24,pw,56,28);ctx.fill();
      ctx.fillStyle='#fffdf9';ctx.textBaseline='middle';ctx.fillText(cfg.place,ix+48,iy+53);
    }
    const ty=iy+ih+54;
    const ft=fitText(ctx,cfg.title,iw-12,66,36,'600',disp);
    ctx.font='600 '+ft.px+'px '+disp;ctx.fillStyle='#1f2f3d';ctx.textBaseline='top';
    ctx.fillText(ft.text,ix+6,ty);
    const sub=[];
    if(cfg.owner&&!cfg.title.toLowerCase().includes(cfg.owner.toLowerCase()))sub.push('by '+cfg.owner);
    if(cfg.stars>0)sub.push('★ '+cfg.stars+(cfg.stars===1?' star':' stars'));
    sub.push('Sand & waves in 3D');
    ctx.font='600 30px '+sans;ctx.fillStyle='#5b6d7c';ctx.fillText(sub.join(' · '),ix+6,ty+ft.px+24);
    const pillText=cfg.shortUrl||'beechshore.com/'+cfg.code;
    ctx.font='700 34px '+sans;const pw2=ctx.measureText(pillText).width+88;
    const px=(F.w-pw2)/2,py=1635;
    ctx.fillStyle='#1e8da3';rrect(ctx,px,py,pw2,84,42);ctx.fill();
    ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(pillText,F.w/2,py+43);
    ctx.font='600 26px '+sans;ctx.fillStyle='#5b6d7c';
    ctx.fillText('Walk the shore · build your own',F.w/2,py+122);
    ctx.textAlign='left';
  }
  if(metaEl)metaEl.textContent=F.label;
  if(stage)stage.classList.add('ready');
};

const toBlob=()=>new Promise(res=>canvas.toBlob(b=>res(b),'image/png'));
const getCaption=()=>capInput?capInput.value.trim():studio.dataset.text||'';
const fileName=()=>cfg.slug+'-'+cfg.code.toLowerCase()+'-'+fmt+'.png';

const syncLinks=()=>{
  const text=getCaption();
  const full=text?text+' '+cfg.url:cfg.url;
  const e=encodeURIComponent;
  const set=(sel,href)=>{const el=studio.querySelector(sel);if(el)el.setAttribute('href',href)};
  set('[data-net="x"]','https://twitter.com/intent/tweet?text='+e(text)+'&url='+e(cfg.url));
  set('[data-net="bsky"]','https://bsky.app/intent/compose?text='+e(full));
  set('[data-net="threads"]','https://www.threads.net/intent/post?text='+e(full));
  set('[data-net="reddit"]','https://www.reddit.com/submit?url='+e(cfg.url)+'&title='+e(text||cfg.title));
  set('[data-net="wa"]','https://wa.me/?text='+e(full));
  set('[data-net="fb"]','https://www.facebook.com/sharer/sharer.php?u='+e(cfg.url));
  set('[data-net="sms"]','sms:?&body='+e(full));
};
if(capInput)capInput.addEventListener('input',syncLinks);

studio.addEventListener('click',async e=>{
  const fb=e.target.closest('[data-fmt]');
  if(fb){
    fmt=fb.dataset.fmt;
    studio.querySelectorAll('[data-fmt]').forEach(x=>x.setAttribute('aria-pressed',String(x===fb)));
    render();return;
  }
  if(e.target.closest('[data-copy-post]')){
    const t=getCaption();
    copyText(t?t+' '+cfg.url:cfg.url,'Post text copied');return;
  }
  if(e.target.closest('[data-download-snap]')){
    const b=pic?await toBlob():null;
    const a=document.createElement('a');
    if(b){const u=URL.createObjectURL(b);a.href=u;a.download=fileName();a.click();setTimeout(()=>URL.revokeObjectURL(u),4000)}
    else{a.href=cfg.img;a.download=fileName();a.click()}
    say('Snapshot saved');return;
  }
  if(e.target.closest('[data-copy-img]')){
    const b=pic?await toBlob():null;
    if(b&&navigator.clipboard&&window.ClipboardItem){
      try{await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);say('Snapshot copied — paste anywhere');return}catch{}
    }
    if(b){const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=fileName();a.click();setTimeout(()=>URL.revokeObjectURL(u),4000);say('Snapshot saved (paste copy not supported here)')}
    return;
  }
  if(e.target.closest('[data-share-snap]')){
    const text=getCaption();
    const b=pic?await toBlob():null;
    if(b&&navigator.share){
      const file=new File([b],fileName(),{type:'image/png'});
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        try{await navigator.share({files:[file],title:cfg.title,text:text+' '+cfg.url,url:cfg.url});return}
        catch(x){if(x&&x.name==='AbortError')return}
      }
      try{await navigator.share({title:cfg.title,text,url:cfg.url});return}
      catch(x){if(x&&x.name==='AbortError')return}
    }
    if(b&&navigator.clipboard&&window.ClipboardItem){
      try{await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);say('Snapshot copied — paste into your post');return}catch{}
    }
    copyText(text?text+' '+cfg.url:cfg.url,'Link & caption copied');
  }
});

const im=new Image();
im.decoding='async';
im.onload=()=>{pic=im;render();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(render)};
im.src=cfg.img;
})();`;
